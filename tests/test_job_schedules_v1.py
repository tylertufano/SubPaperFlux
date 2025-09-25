from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Dict

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.setenv("USER_MGMT_CORE", "1")
    monkeypatch.setenv("USER_MGMT_ENFORCE", "1")

    from app.config import is_user_mgmt_core_enabled, is_user_mgmt_enforce_enabled

    is_user_mgmt_core_enabled.cache_clear()
    is_user_mgmt_enforce_enabled.cache_clear()
    try:
        yield
    finally:
        is_user_mgmt_core_enabled.cache_clear()
        is_user_mgmt_enforce_enabled.cache_clear()


@pytest.fixture()
def client() -> TestClient:
    from app.auth import ensure_admin_role
    from app.auth.oidc import get_current_user
    from app.db import get_session, init_db
    from app.main import create_app
    from app.models import User

    init_db()
    identity = {"sub": "primary", "email": "primary@example.com", "groups": []}

    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: identity
    test_client = TestClient(app)

    with next(get_session()) as session:
        ensure_admin_role(session)
        session.commit()

        for user_id, email in ((identity["sub"], identity["email"]), ("other", "other@example.com")):
            user = session.get(User, user_id)
            if user is None:
                user = User(
                    id=user_id,
                    email=email,
                    full_name=f"{user_id.title()} User",
                )
                session.add(user)
        session.commit()

    try:
        yield test_client
    finally:
        app.dependency_overrides.clear()


def _sample_payload() -> Dict[str, str]:
    return {
        "config_dir": "/tmp/workspace",
        "site_login_pair": "cred-1::site-1",
    }


def test_create_list_get_schedule(client: TestClient):
    create_resp = client.post(
        "/v1/job-schedules",
        json={
            "job_type": "login",
            "payload": _sample_payload(),
            "frequency": "1h",
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    created = create_resp.json()
    assert created["job_type"] == "login"
    assert created["owner_user_id"] == "primary"
    assert created["is_active"] is True
    assert created["payload"] == _sample_payload()

    list_resp = client.get("/v1/job-schedules")
    assert list_resp.status_code == 200
    listing = list_resp.json()
    assert listing["total"] == 1
    assert listing["items"][0]["id"] == created["id"]

    detail_resp = client.get(f"/v1/job-schedules/{created['id']}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["frequency"] == "1h"


def test_update_schedule_fields(client: TestClient):
    create_resp = client.post(
        "/v1/job-schedules",
        json={
            "job_type": "login",
            "payload": _sample_payload(),
            "frequency": "1h",
        },
    )
    schedule_id = create_resp.json()["id"]

    update_resp = client.patch(
        f"/v1/job-schedules/{schedule_id}",
        json={
            "frequency": "6h",
            "next_run_at": datetime(2024, 6, 1, 12, 0, tzinfo=timezone.utc).isoformat(),
        },
    )
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert updated["frequency"] == "6h"
    assert updated["next_run_at"].startswith("2024-06-01T12:00:00")

    second_update_resp = client.patch(
        f"/v1/job-schedules/{schedule_id}",
        json={
            "job_type": "publish",
            "payload": {
                "config_dir": "/tmp/workspace",
                "instapaper_id": "insta-1",
                "url": "https://example.com/article",
            },
        },
    )
    assert second_update_resp.status_code == 200
    second = second_update_resp.json()
    assert second["job_type"] == "publish"
    assert second["payload"]["instapaper_id"] == "insta-1"

    toggle_resp = client.post(f"/v1/job-schedules/{schedule_id}/toggle")
    assert toggle_resp.status_code == 200
    assert toggle_resp.json()["is_active"] is False


def test_validation_errors(client: TestClient):
    bad_payload_resp = client.post(
        "/v1/job-schedules",
        json={
            "job_type": "login",
            "payload": {"config_dir": "/tmp/workspace"},
            "frequency": "1h",
        },
    )
    assert bad_payload_resp.status_code == 422
    detail = bad_payload_resp.json()
    errors = detail["details"]["errors"]
    assert any("Missing payload fields" in err.get("msg", "") for err in errors)

    unknown_type_resp = client.post(
        "/v1/job-schedules",
        json={
            "job_type": "unknown",
            "payload": _sample_payload(),
            "frequency": "1h",
        },
    )
    assert unknown_type_resp.status_code == 400
    unknown_detail = unknown_type_resp.json()
    assert unknown_detail["code"] == "http_error"
    assert unknown_detail["details"]["error"] == "unknown_job_type"

    retention_missing_resp = client.post(
        "/v1/job-schedules",
        json={
            "job_type": "retention",
            "payload": {"older_than": "30d"},
            "frequency": "1d",
        },
    )
    assert retention_missing_resp.status_code == 422
    retention_errors = retention_missing_resp.json()["details"]["errors"]
    assert any("instapaper" in err.get("msg", "") for err in retention_errors)


def test_run_now_creates_job(client: TestClient):
    create_resp = client.post(
        "/v1/job-schedules",
        json={
            "job_type": "login",
            "payload": _sample_payload(),
            "frequency": "1h",
        },
    )
    schedule_id = create_resp.json()["id"]

    run_resp = client.post(f"/v1/job-schedules/{schedule_id}/run-now")
    assert run_resp.status_code == 202
    job_payload = run_resp.json()
    assert job_payload["type"] == "login"
    assert job_payload["owner_user_id"] == "primary"

    from app.db import get_session
    from app.models import JobSchedule

    with next(get_session()) as session:
        schedule = session.get(JobSchedule, schedule_id)
        assert schedule is not None
        assert schedule.last_job_id == job_payload["id"]
        assert schedule.last_run_at is not None
        assert schedule.last_error is None
        assert schedule.last_error_at is None


def test_retention_schedule_accepts_legacy_instapaper_id(client: TestClient):
    create_resp = client.post(
        "/v1/job-schedules",
        json={
            "job_type": "retention",
            "payload": {
                "older_than": "60d",
                "instapaper_id": "cred-inst-1",
            },
            "frequency": "1d",
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    created = create_resp.json()
    assert created["payload"]["instapaper_id"] == "cred-inst-1"


def test_rbac_enforcement(client: TestClient):
    from app.auth import ADMIN_ROLE_NAME, grant_role
    from app.db import get_session
    from app.models import JobSchedule

    with next(get_session()) as session:
        other_schedule = JobSchedule(
            job_type="login",
            payload=_sample_payload(),
            frequency="1h",
            owner_user_id="other",
        )
        session.add(other_schedule)
        session.commit()
        schedule_id = other_schedule.id

    forbidden_detail = client.get(f"/v1/job-schedules/{schedule_id}")
    assert forbidden_detail.status_code == 403

    list_forbidden = client.get("/v1/job-schedules", params={"owner_user_id": "other"})
    assert list_forbidden.status_code == 403

    run_forbidden = client.post(f"/v1/job-schedules/{schedule_id}/run-now")
    assert run_forbidden.status_code == 403

    with next(get_session()) as session:
        grant_role(session, "primary", ADMIN_ROLE_NAME, granted_by_user_id="primary")
        session.commit()

    allowed_detail = client.get(f"/v1/job-schedules/{schedule_id}")
    assert allowed_detail.status_code == 200

    allowed_list = client.get("/v1/job-schedules", params={"owner_user_id": "other"})
    assert allowed_list.status_code == 200
    assert allowed_list.json()["total"] == 1

    allowed_run = client.post(f"/v1/job-schedules/{schedule_id}/run-now")
    assert allowed_run.status_code == 202
