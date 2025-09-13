import os
import base64
import time


def test_worker_retry_backoff(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("CREDENTIALS_ENC_KEY", base64.urlsafe_b64encode(os.urandom(32)).decode())
    monkeypatch.setenv("WORKER_MAX_ATTEMPTS", "2")
    monkeypatch.setenv("WORKER_BACKOFF_BASE", "0.1")

    from app.db import init_db, get_session
    from app.models import Job
    from app.worker import fetch_next_job, mark_failed

    init_db()
    with next(get_session()) as session:
        j = Job(type="unknown", payload={}, status="queued", owner_user_id="u")
        session.add(j)
        session.commit()
        job_id = j.id

    job = fetch_next_job()
    assert job is not None and job.id == job_id
    # Simulate failure twice
    mark_failed(job, "oops")
    with next(get_session()) as session:
        dbj = session.get(Job, job_id)
        assert dbj.status == "queued"
        assert dbj.attempts == 1
        assert dbj.available_at is not None and dbj.available_at > time.time()

    # Second failure should mark failed due to max attempts=2
    mark_failed(job, "oops again")
    with next(get_session()) as session:
        dbj2 = session.get(Job, job_id)
        assert dbj2.status == "failed"
        assert dbj2.attempts == 2

