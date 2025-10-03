from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlmodel import Session, select

from ..models import Job, JobSchedule

logger = logging.getLogger(__name__)

_FREQUENCY_PATTERN = re.compile(r"^\s*(\d+)\s*([smhdwSMHDW])\s*$")
_UNIT_SECONDS = {
    "s": 1,
    "m": 60,
    "h": 60 * 60,
    "d": 60 * 60 * 24,
    "w": 60 * 60 * 24 * 7,
}


def parse_frequency(value: str) -> timedelta:
    """Parse a frequency string like ``"15m"`` or ``"1h"``.

    Returns a :class:`datetime.timedelta` representing the requested interval.
    Raises :class:`ValueError` when the format is invalid.
    """

    if not value:
        raise ValueError("Frequency must be provided")

    match = _FREQUENCY_PATTERN.match(value)
    if not match:
        raise ValueError("Frequency must be an integer followed by s/m/h/d/w")

    amount = int(match.group(1))
    if amount <= 0:
        raise ValueError("Frequency must be greater than zero")

    unit = match.group(2).lower()
    seconds = amount * _UNIT_SECONDS[unit]
    return timedelta(seconds=seconds)


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _advance_next_run(
    *,
    current: Optional[datetime],
    interval: timedelta,
    now: datetime,
) -> datetime:
    baseline = _ensure_utc(now) if current is None else _ensure_utc(current)
    now_utc = _ensure_utc(now)
    while baseline <= now_utc:
        baseline = baseline + interval
    return baseline


def _for_update_kwargs(session: Session) -> dict:
    bind = session.get_bind()
    if not bind:
        return {}
    dialect = bind.dialect
    if not getattr(dialect, "supports_for_update", False):
        return {}
    kwargs: dict = {}
    if getattr(dialect, "supports_for_update_skip_locked", False):
        kwargs["skip_locked"] = True
    return kwargs


def enqueue_due_schedules(
    session: Session,
    *,
    now: Optional[datetime] = None,
) -> List[Job]:
    """Enqueue jobs for schedules whose ``next_run_at`` is due."""

    effective_now = _ensure_utc(now or datetime.now(timezone.utc))

    stmt = (
        select(JobSchedule)
        .where(JobSchedule.is_active.is_(True))
        .where(JobSchedule.next_run_at.is_not(None))
        .where(JobSchedule.next_run_at <= effective_now)
        .order_by(JobSchedule.next_run_at, JobSchedule.id)
    )

    for_update_kwargs = _for_update_kwargs(session)
    if for_update_kwargs:
        stmt = stmt.with_for_update(**for_update_kwargs)

    schedules = session.exec(stmt).all()
    enqueued: List[Job] = []

    for schedule in schedules:
        session.refresh(schedule)

        if not schedule.is_active:
            continue

        next_run_at = schedule.next_run_at

        if not next_run_at:
            continue

        if _ensure_utc(next_run_at) > effective_now:
            continue

        try:
            interval = parse_frequency(schedule.frequency or "")
        except ValueError as exc:  # pragma: no cover - schema validation prevents this
            logger.warning(
                "Unable to parse schedule frequency", extra={"schedule_id": schedule.id, "error": str(exc)}
            )
            schedule.last_error = str(exc)
            schedule.last_error_at = effective_now
            schedule.next_run_at = effective_now + timedelta(minutes=5)
            session.add(schedule)
            continue

        job = Job(
            type=schedule.job_type,
            payload=dict(schedule.payload or {}),
            status="queued",
            owner_user_id=schedule.owner_user_id,
            details={
                "schedule_id": schedule.id,
                "schedule_name": schedule.schedule_name,
            },
        )
        session.add(job)
        session.flush()

        schedule.last_job_id = job.id
        schedule.last_run_at = effective_now
        schedule.last_error = None
        schedule.last_error_at = None
        schedule.next_run_at = _advance_next_run(
            current=schedule.next_run_at,
            interval=interval,
            now=effective_now,
        )
        session.add(schedule)

        enqueued.append(job)

    return enqueued


__all__ = ["enqueue_due_schedules", "parse_frequency"]
