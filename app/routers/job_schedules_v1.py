from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlmodel import select

from ..auth import PERMISSION_MANAGE_BOOKMARKS, has_permission
from ..auth.oidc import get_current_user
from ..db import get_session
from ..jobs import known_job_types
from ..jobs.scheduler import parse_frequency
from ..models import Folder, Job, JobSchedule, Tag
from ..schemas import (
    JobOut,
    JobScheduleCreate,
    JobScheduleOut,
    JobScheduleUpdate,
    JobSchedulesPage,
)


router = APIRouter(prefix="/v1/job-schedules", tags=["v1"])


_SENTINEL = object()


def _current_user_id(current_user: Any) -> Optional[str]:
    if isinstance(current_user, dict):
        value = current_user.get("sub")
        if value:
            return str(value)
    return None


def _ensure_manage_permission(session, current_user: Any, *, owner_id: Optional[str]) -> None:
    user_id = _current_user_id(current_user)
    if owner_id is not None and owner_id == user_id:
        return
    allowed = has_permission(
        session,
        current_user,
        PERMISSION_MANAGE_BOOKMARKS,
        owner_id=owner_id,
    )
    if not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Forbidden")


def _get_schedule_or_404(
    session,
    current_user: Any,
    schedule_id: str,
) -> JobSchedule:
    schedule = session.get(JobSchedule, schedule_id)
    if not schedule:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_manage_permission(session, current_user, owner_id=schedule.owner_user_id)
    return schedule


def _normalize_owner_identifiers(
    raw_values: Iterable[Optional[str]],
    *,
    current_user_id: Optional[str],
) -> List[Optional[str]]:
    normalized: List[Optional[str]] = []
    seen: set[str] = set()
    for raw in raw_values:
        value: Optional[str]
        if raw is None:
            value = current_user_id
        else:
            cleaned = str(raw).strip()
            if not cleaned:
                value = current_user_id
            else:
                lowered = cleaned.lower()
                if lowered in {"me", "self"}:
                    value = current_user_id
                elif lowered in {"global", "none", "null"}:
                    value = None
                else:
                    value = cleaned
        key = value if value is not None else "__global__"
        if key in seen:
            continue
        seen.add(key)
        normalized.append(value)
    return normalized


def _compute_next_run_at(frequency: str, *, now: Optional[datetime] = None) -> datetime:
    try:
        interval = parse_frequency(frequency)
    except ValueError as exc:  # pragma: no cover - schema validation prevents this
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail={"error": "invalid_frequency", "frequency": frequency, "message": str(exc)},
        ) from exc

    effective_now = now or datetime.now(timezone.utc)
    if effective_now.tzinfo is None:
        effective_now = effective_now.replace(tzinfo=timezone.utc)
    else:
        effective_now = effective_now.astimezone(timezone.utc)
    return effective_now + interval


def _ensure_publish_schedule_exclusivity(
    session,
    *,
    instapaper_id: Optional[str],
    feed_id: Optional[Any],
    exclude_schedule_id: Optional[str] = None,
) -> None:
    if not instapaper_id:
        return

    stmt = select(JobSchedule).where(JobSchedule.job_type == "publish")
    rows = session.exec(stmt).all()

    has_wildcard = False
    targeted_feeds: Set[str] = set()

    for existing in rows:
        if exclude_schedule_id and existing.id == exclude_schedule_id:
            continue
        payload = existing.payload or {}
        if payload.get("instapaper_id") != instapaper_id:
            continue
        existing_feed = payload.get("feed_id")
        if existing_feed in (None, ""):
            has_wildcard = True
        else:
            targeted_feeds.add(str(existing_feed))

    is_wildcard_request = feed_id in (None, "")

    if is_wildcard_request:
        if targeted_feeds:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail={
                    "error": "publish_schedule_conflict",
                    "message": "A wildcard publish schedule cannot coexist with targeted publish schedules for this Instapaper credential.",
                    "instapaper_id": instapaper_id,
                    "conflicting_feeds": sorted(targeted_feeds),
                },
            )
        return

    if has_wildcard:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "publish_schedule_conflict",
                "message": "A targeted publish schedule cannot coexist with a wildcard publish schedule for this Instapaper credential.",
                "instapaper_id": instapaper_id,
                "feed_id": str(feed_id),
            },
        )


def _normalize_schedule_targets(payload: Dict[str, Any]) -> Tuple[List[str], Optional[str]]:
    raw_tags = payload.get("tags") or []
    tags: List[str] = []
    if isinstance(raw_tags, list):
        for value in raw_tags:
            text = str(value).strip()
            if text:
                tags.append(text)
    folder_value = payload.get("folder_id")
    if folder_value is None:
        folder_id: Optional[str] = None
    else:
        folder_text = str(folder_value).strip()
        folder_id = folder_text or None
    payload["tags"] = tags
    if folder_id is None:
        payload.pop("folder_id", None)
    else:
        payload["folder_id"] = folder_id
    return tags, folder_id


def _validate_publish_targets(
    session,
    owner_id: Optional[str],
    *,
    tag_ids: List[str],
    folder_id: Optional[str],
) -> None:
    if tag_ids:
        stmt = select(Tag.id).where(Tag.id.in_(tag_ids))
        if owner_id is None:
            stmt = stmt.where(Tag.owner_user_id.is_(None))
        else:
            stmt = stmt.where(Tag.owner_user_id == owner_id)
        rows = session.exec(stmt).all()
        found = {row if isinstance(row, str) else row.id for row in rows}
        missing = [tag_id for tag_id in tag_ids if tag_id not in found]
        if missing:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail={
                    "error": "invalid_publish_tags",
                    "message": "One or more tags do not belong to the schedule owner.",
                    "tag_ids": missing,
                },
            )
    if folder_id:
        folder = session.get(Folder, folder_id)
        if not folder or folder.owner_user_id != owner_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail={
                    "error": "invalid_publish_folder",
                    "message": "Folder does not belong to the schedule owner.",
                    "folder_id": folder_id,
                },
            )


def _schedule_to_schema(schedule: JobSchedule) -> JobScheduleOut:
    payload = dict(schedule.payload or {})
    tags, folder_id = _normalize_schedule_targets(payload)
    if schedule.job_type != "publish":
        payload.pop("tags", None)
        payload.pop("folder_id", None)
    return JobScheduleOut(
        id=schedule.id,
        schedule_name=schedule.schedule_name,
        job_type=schedule.job_type,
        owner_user_id=schedule.owner_user_id,
        payload=payload,
        tags=tags,
        folder_id=folder_id,
        frequency=schedule.frequency,
        next_run_at=schedule.next_run_at,
        last_run_at=schedule.last_run_at,
        last_job_id=schedule.last_job_id,
        last_error=schedule.last_error,
        last_error_at=schedule.last_error_at,
        is_active=bool(schedule.is_active),
    )


def _ensure_unique_schedule_name(
    session,
    owner_id: Optional[str],
    schedule_name: str,
    *,
    exclude_schedule_id: Optional[str] = None,
) -> None:
    stmt = select(JobSchedule).where(JobSchedule.schedule_name == schedule_name)
    if owner_id is None:
        stmt = stmt.where(JobSchedule.owner_user_id.is_(None))
    else:
        stmt = stmt.where(JobSchedule.owner_user_id == owner_id)
    if exclude_schedule_id:
        stmt = stmt.where(JobSchedule.id != exclude_schedule_id)
    existing = session.exec(stmt).first()
    if existing:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="A schedule with this name already exists for the selected scope.",
        )


def _job_to_schema(job: Job) -> JobOut:
    details = dict(job.details or {})
    return JobOut(
        id=job.id,
        type=job.type,
        status=job.status,
        attempts=job.attempts or 0,
        last_error=job.last_error,
        available_at=job.available_at,
        owner_user_id=job.owner_user_id,
        payload=dict(job.payload or {}),
        details=details,
        created_at=job.created_at,
        run_at=job.run_at,
        schedule_id=details.get("schedule_id"),
        schedule_name=details.get("schedule_name"),
    )


def _validate_job_type_or_400(job_type: str) -> None:
    known = known_job_types()
    if job_type not in known:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "unknown_job_type",
                "job_type": job_type,
                "known_types": known,
            },
        )


@router.get("", response_model=JobSchedulesPage, summary="List job schedules")
@router.get("/", response_model=JobSchedulesPage, summary="List job schedules")
def list_job_schedules(
    current_user=Depends(get_current_user),
    session=Depends(get_session),
    owner_user_id: Optional[List[str]] = Query(
        None,
        description=(
            "Filter by one or more owner ids. Repeat the parameter for multiple owners. "
            "Use 'me' to reference the current user and 'global' for shared schedules."
        ),
    ),
    job_type: Optional[str] = Query(None, description="Filter by job type"),
    is_active: Optional[bool] = Query(None, description="Filter by active state"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
):
    user_id = _current_user_id(current_user)
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    requested = owner_user_id or []
    if not requested:
        requested = [user_id]
    normalized = _normalize_owner_identifiers(requested, current_user_id=user_id)

    allowed_owner_ids: List[str] = []
    include_global = False

    for owner in normalized:
        if owner is None:
            _ensure_manage_permission(session, current_user, owner_id=None)
            include_global = True
            continue
        if owner == user_id:
            if owner not in allowed_owner_ids:
                allowed_owner_ids.append(owner)
            continue
        _ensure_manage_permission(session, current_user, owner_id=owner)
        if owner not in allowed_owner_ids:
            allowed_owner_ids.append(owner)

    owner_filters = []
    if allowed_owner_ids:
        owner_filters.append(JobSchedule.owner_user_id.in_(allowed_owner_ids))
    if include_global:
        owner_filters.append(JobSchedule.owner_user_id.is_(None))

    if not owner_filters:
        return JobSchedulesPage(items=[], total=0, page=page, size=size, has_next=False, total_pages=1)

    stmt = select(JobSchedule)
    count_stmt = select(func.count()).select_from(JobSchedule)

    if len(owner_filters) == 1:
        stmt = stmt.where(owner_filters[0])
        count_stmt = count_stmt.where(owner_filters[0])
    else:
        clause = or_(*owner_filters)
        stmt = stmt.where(clause)
        count_stmt = count_stmt.where(clause)

    if job_type:
        _validate_job_type_or_400(job_type)
        stmt = stmt.where(JobSchedule.job_type == job_type)
        count_stmt = count_stmt.where(JobSchedule.job_type == job_type)

    if is_active is not None:
        stmt = stmt.where(JobSchedule.is_active == is_active)
        count_stmt = count_stmt.where(JobSchedule.is_active == is_active)

    stmt = stmt.order_by(JobSchedule.next_run_at, JobSchedule.id)
    stmt = stmt.offset((page - 1) * size).limit(size)

    total = session.exec(count_stmt).one()
    rows = session.exec(stmt).all()

    items = [_schedule_to_schema(row) for row in rows]
    total_int = int(total or 0)
    has_next = (page * size) < total_int
    total_pages = int((total_int + size - 1) // size) if size else 1
    return JobSchedulesPage(
        items=items,
        total=total_int,
        page=page,
        size=size,
        has_next=has_next,
        total_pages=total_pages or 1,
    )


@router.post("", response_model=JobScheduleOut, status_code=status.HTTP_201_CREATED, summary="Create a job schedule")
@router.post("/", response_model=JobScheduleOut, status_code=status.HTTP_201_CREATED, summary="Create a job schedule")
def create_job_schedule(
    body: JobScheduleCreate,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    user_id = _current_user_id(current_user)
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    _validate_job_type_or_400(body.job_type)

    owner_id = body.owner_user_id if body.owner_user_id is not None else user_id
    _ensure_manage_permission(session, current_user, owner_id=owner_id)

    _ensure_unique_schedule_name(session, owner_id, body.schedule_name)

    payload = dict(body.payload or {})
    if body.tags is not None:
        payload["tags"] = body.tags
    if body.folder_id is not None or "folder_id" in payload:
        payload["folder_id"] = body.folder_id
    normalized_tags, normalized_folder_id = _normalize_schedule_targets(payload)

    if body.job_type == "publish":
        _ensure_publish_schedule_exclusivity(
            session,
            instapaper_id=payload.get("instapaper_id"),
            feed_id=payload.get("feed_id"),
        )
        _validate_publish_targets(
            session,
            owner_id,
            tag_ids=normalized_tags,
            folder_id=normalized_folder_id,
        )

    next_run_at = body.next_run_at
    if next_run_at is None:
        next_run_at = _compute_next_run_at(body.frequency)

    schedule = JobSchedule(
        schedule_name=body.schedule_name,
        job_type=body.job_type,
        payload=payload,
        frequency=body.frequency,
        next_run_at=next_run_at,
        is_active=body.is_active,
        owner_user_id=owner_id,
    )
    session.add(schedule)
    session.commit()
    session.refresh(schedule)
    return _schedule_to_schema(schedule)


@router.get("/{schedule_id}", response_model=JobScheduleOut, summary="Get a job schedule")
def get_job_schedule(
    schedule_id: str,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    schedule = _get_schedule_or_404(session, current_user, schedule_id)
    return _schedule_to_schema(schedule)


@router.patch("/{schedule_id}", response_model=JobScheduleOut, summary="Update a job schedule")
def update_job_schedule(
    schedule_id: str,
    body: JobScheduleUpdate,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    schedule = _get_schedule_or_404(session, current_user, schedule_id)

    was_active = bool(schedule.is_active)
    updates = body.model_dump(exclude_unset=True)
    raw_payload_update = updates.pop("payload", _SENTINEL)
    tags_update = updates.pop("tags", _SENTINEL)
    folder_update = updates.pop("folder_id", _SENTINEL)
    if "job_type" in updates:
        _validate_job_type_or_400(updates["job_type"])

    if "schedule_name" in updates:
        next_name = updates["schedule_name"]
        if next_name is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Schedule name cannot be null.",
            )
        _ensure_unique_schedule_name(
            session,
            schedule.owner_user_id,
            next_name,
            exclude_schedule_id=schedule.id,
        )

    prospective_job_type = updates.get("job_type", schedule.job_type)

    base_payload = dict(schedule.payload or {})
    if raw_payload_update is not _SENTINEL:
        base_payload.update(dict(raw_payload_update or {}))
    if tags_update is not _SENTINEL:
        base_payload["tags"] = tags_update or []
    if folder_update is not _SENTINEL:
        base_payload["folder_id"] = folder_update

    normalized_tags, normalized_folder_id = _normalize_schedule_targets(base_payload)

    if prospective_job_type == "publish":
        _ensure_publish_schedule_exclusivity(
            session,
            instapaper_id=base_payload.get("instapaper_id"),
            feed_id=base_payload.get("feed_id"),
            exclude_schedule_id=schedule.id,
        )
        _validate_publish_targets(
            session,
            schedule.owner_user_id,
            tag_ids=normalized_tags,
            folder_id=normalized_folder_id,
        )

    if "job_type" in updates:
        schedule.job_type = updates["job_type"]
    payload_changed = (
        raw_payload_update is not _SENTINEL
        or tags_update is not _SENTINEL
        or folder_update is not _SENTINEL
    )
    if payload_changed:
        schedule.payload = base_payload
    if "frequency" in updates:
        schedule.frequency = updates["frequency"]
    if "next_run_at" in updates:
        schedule.next_run_at = updates["next_run_at"]
    if "is_active" in updates:
        schedule.is_active = updates["is_active"]
    if "schedule_name" in updates:
        schedule.schedule_name = updates["schedule_name"]

    became_active = bool(schedule.is_active) and not was_active and updates.get("is_active")
    if became_active and schedule.next_run_at is None:
        schedule.next_run_at = _compute_next_run_at(schedule.frequency)

    session.add(schedule)
    session.commit()
    session.refresh(schedule)
    return _schedule_to_schema(schedule)


@router.post("/{schedule_id}/toggle", response_model=JobScheduleOut, summary="Toggle schedule active state")
def toggle_job_schedule(
    schedule_id: str,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    schedule = _get_schedule_or_404(session, current_user, schedule_id)
    was_active = bool(schedule.is_active)
    schedule.is_active = not was_active
    if schedule.is_active and not was_active and schedule.next_run_at is None:
        schedule.next_run_at = _compute_next_run_at(schedule.frequency)
    session.add(schedule)
    session.commit()
    session.refresh(schedule)
    return _schedule_to_schema(schedule)


@router.delete("/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a job schedule")
def delete_job_schedule(
    schedule_id: str,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    schedule = _get_schedule_or_404(session, current_user, schedule_id)
    session.delete(schedule)
    session.commit()
    return None


@router.post(
    "/{schedule_id}/run-now",
    response_model=JobOut,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Enqueue a job for immediate execution",
)
def run_job_schedule_now(
    schedule_id: str,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    schedule = _get_schedule_or_404(session, current_user, schedule_id)
    _validate_job_type_or_400(schedule.job_type)

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

    schedule.last_job_id = job.id
    schedule.last_run_at = datetime.now(timezone.utc)
    schedule.last_error = None
    schedule.last_error_at = None
    session.add(schedule)

    session.commit()
    session.refresh(job)
    session.refresh(schedule)

    return _job_to_schema(job)
