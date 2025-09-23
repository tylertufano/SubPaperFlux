import base64
from datetime import datetime, timedelta, timezone

import os

import pytest


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.setenv("CREDENTIALS_ENC_KEY", base64.urlsafe_b64encode(os.urandom(32)).decode())
    yield


def _sample_payload():
    return {
        "config_dir": "/tmp/workspace",
        "site_config_id": "site-1",
        "credential_id": "cred-1",
    }


def test_enqueue_due_schedules_advances_next_run():
    from sqlmodel import select

    from app.db import get_session, init_db
    from app.jobs.scheduler import enqueue_due_schedules, parse_frequency
    from app.models import Job, JobSchedule

    init_db()

    now = datetime(2024, 1, 1, 12, 0, tzinfo=timezone.utc)
    initial_next_run = now - timedelta(minutes=5)

    with next(get_session()) as session:
        schedule = JobSchedule(
            job_type="login",
            payload=_sample_payload(),
            frequency="1h",
            next_run_at=initial_next_run,
            owner_user_id="owner",
        )
        session.add(schedule)
        session.commit()
        schedule_id = schedule.id

    with next(get_session()) as session:
        with session.begin():
            jobs = enqueue_due_schedules(session, now=now)
            assert len(jobs) == 1
            job = jobs[0]
            schedule = session.get(JobSchedule, schedule_id)
            assert schedule is not None
            assert schedule.last_job_id == job.id
            assert schedule.last_run_at == now
            assert schedule.last_error is None
            assert schedule.last_error_at is None
            assert schedule.next_run_at == initial_next_run + parse_frequency("1h")
            assert job.details.get("schedule_id") == schedule_id
        persisted_jobs = session.exec(select(Job)).all()
        assert len(persisted_jobs) == 1

    with next(get_session()) as session:
        with session.begin():
            jobs = enqueue_due_schedules(session, now=now)
            assert jobs == []


def test_scheduler_skips_inactive_or_future():
    from app.db import get_session, init_db
    from app.jobs.scheduler import enqueue_due_schedules
    from app.models import JobSchedule

    init_db()

    future_time = datetime(2024, 1, 1, 12, 0, tzinfo=timezone.utc)

    with next(get_session()) as session:
        inactive = JobSchedule(
            job_type="login",
            payload=_sample_payload(),
            frequency="1h",
            next_run_at=future_time - timedelta(minutes=10),
            owner_user_id="owner",
            is_active=False,
        )
        upcoming = JobSchedule(
            job_type="login",
            payload=_sample_payload(),
            frequency="1h",
            next_run_at=future_time + timedelta(minutes=10),
            owner_user_id="owner",
        )
        session.add(inactive)
        session.add(upcoming)
        session.commit()
        inactive_id = inactive.id
        upcoming_id = upcoming.id

    with next(get_session()) as session:
        with session.begin():
            jobs = enqueue_due_schedules(session, now=future_time)
            assert jobs == []

        assert session.get(JobSchedule, inactive_id).last_job_id is None
        assert session.get(JobSchedule, upcoming_id).last_job_id is None


def test_schedule_error_tracking(monkeypatch):
    monkeypatch.setenv("WORKER_BACKOFF_BASE", "0")
    monkeypatch.setenv("WORKER_MAX_ATTEMPTS", "2")

    from app.db import get_session, init_db
    from app.jobs.scheduler import enqueue_due_schedules
    from app.models import JobSchedule
    from app.worker import fetch_next_job, mark_done, mark_failed

    init_db()

    now = datetime(2024, 1, 1, 12, 0, tzinfo=timezone.utc)

    with next(get_session()) as session:
        schedule = JobSchedule(
            job_type="login",
            payload=_sample_payload(),
            frequency="1h",
            next_run_at=now - timedelta(minutes=1),
            owner_user_id="owner",
        )
        session.add(schedule)
        session.commit()
        schedule_id = schedule.id

    with next(get_session()) as session:
        with session.begin():
            enqueue_due_schedules(session, now=now)

    job = fetch_next_job()
    assert job is not None

    mark_failed(job, "boom")

    with next(get_session()) as session:
        schedule = session.get(JobSchedule, schedule_id)
        assert schedule is not None
        assert schedule.last_error == "boom"
        assert schedule.last_error_at is not None

    job = fetch_next_job()
    assert job is not None

    mark_done(job, {"ok": True})

    with next(get_session()) as session:
        schedule = session.get(JobSchedule, schedule_id)
        assert schedule is not None
        assert schedule.last_error is None
        assert schedule.last_error_at is None


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("15m", timedelta(minutes=15)),
        ("1h", timedelta(hours=1)),
        ("2D", timedelta(days=2)),
        ("1w", timedelta(weeks=1)),
    ],
)
def test_parse_frequency_valid(raw, expected):
    from app.jobs.scheduler import parse_frequency

    assert parse_frequency(raw) == expected


@pytest.mark.parametrize("raw", ["", "0h", "five", "10x"])
def test_parse_frequency_invalid(raw):
    from app.jobs.scheduler import parse_frequency

    with pytest.raises(ValueError):
        parse_frequency(raw)
