import time
import logging
import os
from contextlib import contextmanager
from typing import Optional, Dict, Any

from sqlmodel import select

from .config import is_user_mgmt_enforce_enabled
from .db import (
    get_session_ctx as db_session_ctx,
    reset_current_user_id,
    set_current_user_id,
)
from .models import Job
from .jobs import get_handler  # import registry
from .observability.logging import bind_job_id
from .observability.metrics import JOB_COUNTER, JOB_DURATION


POLL_INTERVAL = float(os.getenv("WORKER_POLL_INTERVAL", "2.0"))


def _max_attempts(job_type: str) -> int:
    env_key = f"WORKER_MAX_ATTEMPTS_{job_type.upper()}"
    return int(os.getenv(env_key, os.getenv("WORKER_MAX_ATTEMPTS", "3")))


def _backoff_base(job_type: str) -> float:
    env_key = f"WORKER_BACKOFF_BASE_{job_type.upper()}"
    return float(os.getenv(env_key, os.getenv("WORKER_BACKOFF_BASE", "2")))


@contextmanager
def session_ctx():
    with db_session_ctx() as session:
        yield session


@contextmanager
def job_owner_ctx(owner_user_id: Optional[str]):
    if not is_user_mgmt_enforce_enabled():
        yield
        return

    token = set_current_user_id(owner_user_id)
    try:
        yield
    finally:
        reset_current_user_id(token)


def fetch_next_job() -> Optional[Job]:
    with session_ctx() as session:
        now = time.time()
        stmt = (
            select(Job)
            .where(Job.status == "queued")
            .where((Job.available_at.is_(None)) | (Job.available_at <= now))
            .order_by(Job.attempts.asc())
            .limit(1)
        )
        job = session.exec(stmt).first()
        if job:
            job.status = "in_progress"
            session.add(job)
            session.commit()
            session.refresh(job)
            return job
    return None


def process_job(job: Job) -> Dict[str, Any]:
    bind_job_id(job.id)
    logging.info("Processing job", extra={"event": "job_start", "job_id": job.id, "type": job.type})
    handler = get_handler(job.type)
    if not handler:
        raise RuntimeError(f"No handler registered for job type: {job.type}")
    start = time.time()
    try:
        res = handler(job_id=job.id, owner_user_id=job.owner_user_id, payload=job.payload or {})
        JOB_COUNTER.labels(job.type or "unknown", "done").inc()
        JOB_DURATION.observe(time.time() - start)
        return res or {}
    except Exception:
        JOB_COUNTER.labels(job.type or "unknown", "failed").inc()
        JOB_DURATION.observe(time.time() - start)
        raise


def mark_done(job: Job, details: Dict[str, Any] | None = None) -> None:
    with session_ctx() as session:
        db_job = session.get(Job, job.id)
        if db_job:
            db_job.status = "done"
            db_job.last_error = None
            if details is not None:
                db_job.details = details
            session.add(db_job)
            session.commit()
    logging.info("Job done", extra={"event": "job_done", "job_id": job.id, "type": job.type})


def mark_failed(job: Job, error: str) -> None:
    with session_ctx() as session:
        db_job = session.get(Job, job.id)
        if db_job:
            db_job.attempts = (db_job.attempts or 0) + 1
            db_job.last_error = error[:500]
            max_attempts = _max_attempts(db_job.type or "")
            if db_job.attempts < max_attempts:
                # Exponential backoff
                base = _backoff_base(db_job.type or "")
                delay = base * (2 ** (db_job.attempts - 1))
                db_job.available_at = time.time() + delay
                db_job.status = "queued"
            else:
                db_job.status = "failed"
                db_job.available_at = None
            session.add(db_job)
            session.commit()
    logging.warning("Job error", extra={"event": "job_error", "job_id": job.id, "type": job.type, "error": error})


def run_forever():
    logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s: %(message)s")
    logging.info("Worker started")
    try:
        while True:
            job = fetch_next_job()
            if not job:
                time.sleep(POLL_INTERVAL)
                continue
            with job_owner_ctx(job.owner_user_id):
                try:
                    details = process_job(job)
                    mark_done(job, details)
                except Exception as e:  # noqa: BLE001
                    logging.exception("Job %s failed: %s", job.id, e)
                    mark_failed(job, str(e))
    except KeyboardInterrupt:
        logging.info("Worker stopped by user")


if __name__ == "__main__":
    run_forever()
