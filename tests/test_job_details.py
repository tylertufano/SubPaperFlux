import os, base64
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
