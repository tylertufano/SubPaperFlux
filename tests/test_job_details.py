import asyncio
import base64
import json
import os
from contextlib import suppress
from datetime import datetime, timezone

from fastapi.testclient import TestClient


def test_job_details_and_retry_all(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("CREDENTIALS_ENC_KEY", base64.urlsafe_b64encode(os.urandom(32)).decode())

    from app.db import init_db, get_session
    from app.jobs.registry import register_handler
    from app.models import Job
    from app.worker import fetch_next_job, process_job, mark_done

    init_db()

    def dummy_handler(job_id: str, owner_user_id: str | None, payload: dict):
        return {"foo": "bar"}

    register_handler("dummy", dummy_handler)

    with next(get_session()) as session:
        j = Job(type="dummy", payload={}, status="queued", owner_user_id="u")
        session.add(j)
        session.commit()
        job_id = j.id

    job = fetch_next_job()
    details = process_job(job)
    mark_done(job, details)

    with next(get_session()) as session:
        dbj = session.get(Job, job_id)
        assert dbj.details["foo"] == "bar"
        assert dbj.run_at is not None
        assert dbj.created_at is not None

        # create failed and dead jobs
        j1 = Job(type="dummy", payload={}, owner_user_id="u", status="failed")
        j2 = Job(type="dummy", payload={}, owner_user_id="u", status="dead")
        session.add(j1)
        session.add(j2)
        session.commit()
        failed_id, dead_id = j1.id, j2.id

    from app.main import create_app
    from app.auth.oidc import get_current_user
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u", "groups": []}
    client = TestClient(app)

    r = client.post("/v1/jobs/retry-all", json={"status": ["failed", "dead"]})
    assert r.status_code == 200
    assert r.json()["requeued"] == 2

    with next(get_session()) as session:
        assert session.get(Job, failed_id).status == "queued"
        assert session.get(Job, dead_id).status == "queued"
        # cleanup so other tests aren't affected
        session.delete(session.get(Job, failed_id))
        session.delete(session.get(Job, dead_id))
        session.delete(session.get(Job, job_id))
        session.commit()


def test_stream_jobs_respects_rls(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("USER_MGMT_RLS_ENFORCE", "1")

    from app import db as db_module
    from app.routers import jobs_v1 as jobs_router
    from app.schemas import JobOut, JobsPage

    def fake_configure_rls(session):
        session.app_user_id = db_module.get_current_user_id()
        return True

    monkeypatch.setattr(db_module, "_configure_rls", fake_configure_rls)

    captured_calls = []

    def fake_list_jobs(
        *,
        current_user,
        session,
        status=None,
        type=None,
        page=1,
        size=20,
        order_by="run_at",
        order_dir="desc",
    ):
        captured_calls.append(
            {
                "status": status,
                "type": type,
                "page": page,
                "size": size,
                "order_by": order_by,
                "order_dir": order_dir,
            }
        )
        now = datetime.now(timezone.utc)
        other_job = JobOut(
            id="other-job",
            type="dummy",
            status="queued",
            attempts=0,
            last_error=None,
            available_at=None,
            owner_user_id="other-user",
            payload={},
            details={},
            created_at=now,
            run_at=None,
        )
        own_job = JobOut(
            id="own-job",
            type="dummy",
            status="queued",
            attempts=0,
            last_error=None,
            available_at=None,
            owner_user_id=getattr(session, "app_user_id", None) or current_user["sub"],
            payload={},
            details={},
            created_at=now,
            run_at=None,
        )
        if getattr(session, "app_user_id", None):
            items = [job for job in (other_job, own_job) if job.owner_user_id == session.app_user_id]
        else:
            items = [other_job, own_job]
        return JobsPage(items=items, total=len(items), page=page, size=size, has_next=False, total_pages=1)

    monkeypatch.setattr(jobs_router, "list_jobs", fake_list_jobs)

    results = {}

    async def exercise() -> None:
        token = db_module.set_current_user_id("stream-user")
        iterator = None
        try:
            response = await jobs_router.stream_jobs(
                current_user={"sub": "stream-user", "groups": []},
                status="queued",
                type="dummy",
                page=2,
                size=7,
                order_by="available_at",
                order_dir="asc",
            )
            iterator = response.body_iterator
            first_chunk = await anext(iterator)
            text = first_chunk.decode() if isinstance(first_chunk, bytes) else first_chunk
            assert text.startswith("data: ")
            results["event"] = json.loads(text[len("data: ") :].strip())
        finally:
            if iterator is not None and hasattr(iterator, "aclose"):
                with suppress(Exception):
                    await iterator.aclose()
            db_module.reset_current_user_id(token)

    asyncio.run(exercise())

    first_event = results["event"]

    assert len(first_event["items"]) == 1
    assert first_event["items"][0]["owner_user_id"] == "stream-user"
    assert captured_calls == [
        {
            "status": "queued",
            "type": "dummy",
            "page": 2,
            "size": 7,
            "order_by": "available_at",
            "order_dir": "asc",
        }
    ]
