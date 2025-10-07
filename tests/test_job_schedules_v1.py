from __future__ import annotations

from datetime import datetime, timezone, timedelta
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
        "site_login_pair": "cred-1::site-1",
    }


class _ControlledDateTime(datetime):
    current: datetime = datetime.now(timezone.utc)

    @classmethod
    def now(cls, tz=None):  # type: ignore[override]
        value = cls.current
        if tz is None:
            return value.replace(tzinfo=None) if value.tzinfo else value
        if value.tzinfo is None:
            return value.replace(tzinfo=tz)
        return value.astimezone(tz)


def _install_controlled_now(monkeypatch, when: datetime):
    from app.routers import job_schedules_v1

    _ControlledDateTime.current = when
    monkeypatch.setattr(job_schedules_v1, "datetime", _ControlledDateTime)
    return _ControlledDateTime


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _normalize(dt: datetime) -> datetime:
    return dt.replace(tzinfo=None) if dt.tzinfo else dt


def test_create_schedule_defaults_next_run_when_omitted(client: TestClient, monkeypatch):
    fixed_now = datetime(2024, 1, 1, 12, 0, tzinfo=timezone.utc)
    _install_controlled_now(monkeypatch, fixed_now)

    create_resp = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "login-default",
            "job_type": "login",
            "payload": _sample_payload(),
            "frequency": "15m",
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    created = create_resp.json()

    assert created["schedule_name"] == "login-default"
    assert created["next_run_at"] is not None
    next_run_at = _parse_iso(created["next_run_at"])
    assert next_run_at == _normalize(fixed_now + timedelta(minutes=15))


def test_toggle_reactivation_restores_next_run_when_missing(client: TestClient, monkeypatch):
    base_time = datetime(2024, 1, 2, 8, 30, tzinfo=timezone.utc)
    controller = _install_controlled_now(monkeypatch, base_time)

    create_resp = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "toggle-schedule",
            "job_type": "login",
            "payload": _sample_payload(),
            "frequency": "1h",
        },
    )
    schedule_id = create_resp.json()["id"]

    pause_resp = client.post(f"/v1/job-schedules/{schedule_id}/toggle")
    assert pause_resp.status_code == 200
    assert pause_resp.json()["is_active"] is False

    clear_resp = client.patch(
        f"/v1/job-schedules/{schedule_id}",
        json={"next_run_at": None},
    )
    assert clear_resp.status_code == 200
    assert clear_resp.json()["next_run_at"] is None

    resume_time = datetime(2024, 1, 2, 9, 45, tzinfo=timezone.utc)
    controller.current = resume_time

    resume_resp = client.post(f"/v1/job-schedules/{schedule_id}/toggle")
    assert resume_resp.status_code == 200
    resumed = resume_resp.json()
    assert resumed["is_active"] is True

    resumed_next_run = _parse_iso(resumed["next_run_at"])
    assert resumed_next_run == _normalize(resume_time + timedelta(hours=1))


def test_patch_reactivation_restores_next_run_when_missing(client: TestClient, monkeypatch):
    base_time = datetime(2024, 1, 3, 10, 0, tzinfo=timezone.utc)
    controller = _install_controlled_now(monkeypatch, base_time)

    create_resp = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "patch-reactivate",
            "job_type": "login",
            "payload": _sample_payload(),
            "frequency": "30m",
        },
    )
    schedule_id = create_resp.json()["id"]

    pause_resp = client.post(f"/v1/job-schedules/{schedule_id}/toggle")
    assert pause_resp.status_code == 200
    assert pause_resp.json()["is_active"] is False

    clear_resp = client.patch(
        f"/v1/job-schedules/{schedule_id}",
        json={"next_run_at": None},
    )
    assert clear_resp.status_code == 200
    assert clear_resp.json()["next_run_at"] is None

    resume_time = datetime(2024, 1, 3, 11, 15, tzinfo=timezone.utc)
    controller.current = resume_time

    reactivate_resp = client.patch(
        f"/v1/job-schedules/{schedule_id}",
        json={"is_active": True},
    )
    assert reactivate_resp.status_code == 200
    reactivated = reactivate_resp.json()
    assert reactivated["is_active"] is True

    reactivated_next_run = _parse_iso(reactivated["next_run_at"])
    assert reactivated_next_run == _normalize(resume_time + timedelta(minutes=30))


def test_create_list_get_schedule(client: TestClient):
    create_resp = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "list-schedule",
            "job_type": "login",
            "payload": _sample_payload(),
            "frequency": "1h",
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    created = create_resp.json()
    assert created["job_type"] == "login"
    assert created["is_active"] is True
    assert created["payload"] == _sample_payload()
    assert created["schedule_name"] == "list-schedule"
    assert "owner_user_id" not in created

    list_resp = client.get("/v1/job-schedules")
    assert list_resp.status_code == 200
    listing = list_resp.json()
    assert listing["total"] == 1
    assert listing["items"][0]["id"] == created["id"]
    assert listing["items"][0]["schedule_name"] == "list-schedule"
    assert "owner_user_id" not in listing["items"][0]

    detail_resp = client.get(f"/v1/job-schedules/{created['id']}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["frequency"] == "1h"
    assert detail["schedule_name"] == "list-schedule"
    assert "owner_user_id" not in detail


def test_update_schedule_fields(client: TestClient):
    create_resp = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "update-schedule",
            "job_type": "login",
            "payload": _sample_payload(),
            "frequency": "1h",
        },
    )
    schedule_id = create_resp.json()["id"]

    from app.db import get_session
    from app.models import Feed

    with next(get_session()) as session:
        feed = Feed(
            owner_user_id="primary",
            url="https://example.com/rss.xml",
            poll_frequency="1h",
        )
        session.add(feed)
        session.commit()
        session.refresh(feed)
        feed_id = feed.id

    update_resp = client.patch(
        f"/v1/job-schedules/{schedule_id}",
        json={
            "schedule_name": "update-schedule-renamed",
            "frequency": "6h",
            "next_run_at": datetime(2024, 6, 1, 12, 0, tzinfo=timezone.utc).isoformat(),
        },
    )
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert updated["schedule_name"] == "update-schedule-renamed"
    assert updated["frequency"] == "6h"
    assert updated["next_run_at"].startswith("2024-06-01T12:00:00")

    second_update_resp = client.patch(
        f"/v1/job-schedules/{schedule_id}",
        json={
            "job_type": "publish",
            "payload": {
                "instapaper_id": "insta-1",
                "feed_id": feed_id,
            },
        },
    )
    assert second_update_resp.status_code == 200
    second = second_update_resp.json()
    assert second["job_type"] == "publish"
    assert second["payload"]["instapaper_id"] == "insta-1"
    assert second["payload"]["feed_id"] == feed_id
    assert second["schedule_name"] == "update-schedule-renamed"

    toggle_resp = client.post(f"/v1/job-schedules/{schedule_id}/toggle")
    assert toggle_resp.status_code == 200
    assert toggle_resp.json()["is_active"] is False


def test_validation_errors(client: TestClient):
    bad_payload_resp = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "invalid-schedule",
            "job_type": "login",
            "payload": {"site_login_pair": ""},
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
            "schedule_name": "unknown-type",
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
            "schedule_name": "retention-missing",
            "job_type": "retention",
            "payload": {"older_than": "30d"},
            "frequency": "1d",
        },
    )
    assert retention_missing_resp.status_code == 422
    retention_errors = retention_missing_resp.json()["details"]["errors"]
    assert any("instapaper" in err.get("msg", "") for err in retention_errors)

def test_create_rss_schedule_without_instapaper(client: TestClient):
    from app.db import get_session
    from app.models import Feed

    with next(get_session()) as session:
        feed = Feed(
            owner_user_id="primary",
            url="https://example.com/rss.xml",
            poll_frequency="1h",
        )
        session.add(feed)
        session.commit()
        session.refresh(feed)
        feed_id = feed.id

    create_resp = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "rss-schedule",
            "job_type": "rss_poll",
            "payload": {"feed_id": feed_id},
            "frequency": "1h",
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    schedule = create_resp.json()
    assert schedule["payload"].get("feed_id") == feed_id
    assert "instapaper_id" not in schedule["payload"]


def test_schedule_name_uniqueness(client: TestClient):
    first = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "duplicate-name",
            "job_type": "login",
            "payload": _sample_payload(),
            "frequency": "1h",
        },
    )
    assert first.status_code == 201, first.text

    duplicate = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "duplicate-name",
            "job_type": "login",
            "payload": _sample_payload(),
            "frequency": "1h",
        },
    )
    assert duplicate.status_code == 400
    error_payload = duplicate.json()
    message = error_payload.get("message") or error_payload.get("detail") or ""
    assert "name" in message.lower()


def test_owner_scope_parameters_are_rejected(client: TestClient):
    null_owner = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "null-owner",
            "job_type": "login",
            "payload": _sample_payload(),
            "frequency": "1h",
            "owner_user_id": None,
        },
    )
    assert null_owner.status_code == 422
    null_errors = null_owner.json()["details"]["errors"]
    assert any("owner_user_id is no longer accepted" in err.get("msg", "") for err in null_errors)

    explicit_owner = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "explicit-owner",
            "job_type": "login",
            "payload": _sample_payload(),
            "frequency": "1h",
            "ownerUserId": "other",
        },
    )
    assert explicit_owner.status_code == 422
    explicit_errors = explicit_owner.json()["details"]["errors"]
    assert any("owner_user_id is no longer accepted" in err.get("msg", "") for err in explicit_errors)


def test_run_now_creates_job(client: TestClient):
    create_resp = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "run-now",
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
    assert job_payload["schedule_name"] == "run-now"

    from app.db import get_session
    from app.models import JobSchedule

    with next(get_session()) as session:
        schedule = session.get(JobSchedule, schedule_id)
        assert schedule is not None
        assert schedule.last_job_id == job_payload["id"]
        assert schedule.last_run_at is not None
        assert schedule.last_error is None
        assert schedule.last_error_at is None


def test_retention_schedule_requires_explicit_instapaper_credential(client: TestClient):
    create_resp = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "retention-valid",
            "job_type": "retention",
            "payload": {
                "older_than": "60d",
                "instapaper_credential_id": "cred-inst-1",
                "feed_id": "feed-123",
            },
            "frequency": "1d",
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    created = create_resp.json()
    assert created["payload"]["instapaper_credential_id"] == "cred-inst-1"
    assert created["payload"]["feed_id"] == "feed-123"


def test_retention_schedule_rejects_legacy_instapaper_id(client: TestClient):
    create_resp = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "retention-legacy",
            "job_type": "retention",
            "payload": {
                "older_than": "60d",
                "instapaper_id": "cred-inst-1",
            },
            "frequency": "1d",
        },
    )
    assert create_resp.status_code == 422


def test_create_publish_wildcard_schedule(client: TestClient):
    create_resp = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "publish-wildcard",
            "job_type": "publish",
            "payload": {"instapaper_id": "insta-wild"},
            "frequency": "1h",
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    created = create_resp.json()
    assert created["payload"]["instapaper_id"] == "insta-wild"
    assert created["payload"].get("feed_id") in (None, "")


def test_create_publish_schedule_with_tags_and_folder(client: TestClient):
    from app.db import get_session
    from app.models import Folder, Tag

    with next(get_session()) as session:
        tag_one = Tag(owner_user_id="primary", name="Daily")
        tag_two = Tag(owner_user_id="primary", name="Focus")
        folder = Folder(owner_user_id="primary", name="Reading List")
        session.add(tag_one)
        session.add(tag_two)
        session.add(folder)
        session.commit()
        tag_one_id = tag_one.id
        tag_two_id = tag_two.id
        folder_id = folder.id

    create_resp = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "publish-with-tags",
            "job_type": "publish",
            "payload": {"instapaper_id": "insta-123"},
            "tags": [tag_one_id, tag_two_id],
            "folder_id": folder_id,
            "frequency": "2h",
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    created = create_resp.json()
    assert created["tags"] == [tag_one_id, tag_two_id]
    assert created["folder_id"] == folder_id
    assert created["payload"]["tags"] == [tag_one_id, tag_two_id]
    assert created["payload"]["folder_id"] == folder_id


def test_publish_targeted_conflicts_with_existing_wildcard(client: TestClient):
    wildcard_resp = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "publish-wildcard-conflict",
            "job_type": "publish",
            "payload": {"instapaper_id": "insta-conflict"},
            "frequency": "1h",
        },
    )
    assert wildcard_resp.status_code == 201, wildcard_resp.text

    from app.db import get_session
    from app.models import Feed

    with next(get_session()) as session:
        feed = Feed(
            owner_user_id="primary",
            url="https://example.com/targeted.xml",
            poll_frequency="1h",
        )
        session.add(feed)
        session.commit()
        session.refresh(feed)
        feed_id = feed.id

    targeted_resp = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "publish-targeted-conflict",
            "job_type": "publish",
            "payload": {"instapaper_id": "insta-conflict", "feed_id": feed_id},
            "frequency": "1h",
        },
    )
    assert targeted_resp.status_code == 400
    targeted_error = targeted_resp.json()
    assert targeted_error["details"]["error"] == "publish_schedule_conflict"

    update_targeted_schedule = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "publish-update-source",
            "job_type": "login",
            "payload": _sample_payload(),
            "frequency": "1h",
        },
    )
    assert update_targeted_schedule.status_code == 201, update_targeted_schedule.text
    schedule_id = update_targeted_schedule.json()["id"]

    update_resp = client.patch(
        f"/v1/job-schedules/{schedule_id}",
        json={
            "job_type": "publish",
            "payload": {"instapaper_id": "insta-conflict", "feed_id": feed_id},
        },
    )
    assert update_resp.status_code == 400
    update_error = update_resp.json()
    assert update_error["details"]["error"] == "publish_schedule_conflict"


def test_publish_wildcard_conflicts_with_existing_targeted(client: TestClient):
    from app.db import get_session
    from app.models import Feed

    with next(get_session()) as session:
        feed = Feed(
            owner_user_id="primary",
            url="https://example.com/conflict.xml",
            poll_frequency="1h",
        )
        session.add(feed)
        session.commit()
        session.refresh(feed)
        feed_id = feed.id

    targeted_resp = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "publish-targeted-existing",
            "job_type": "publish",
            "payload": {"instapaper_id": "insta-targeted", "feed_id": feed_id},
            "frequency": "1h",
        },
    )
    assert targeted_resp.status_code == 201, targeted_resp.text

    wildcard_resp = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "publish-wildcard-attempt",
            "job_type": "publish",
            "payload": {"instapaper_id": "insta-targeted"},
            "frequency": "1h",
        },
    )
    assert wildcard_resp.status_code == 400
    wildcard_error = wildcard_resp.json()
    assert wildcard_error["details"]["error"] == "publish_schedule_conflict"

    update_schedule = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "publish-update-target",
            "job_type": "login",
            "payload": _sample_payload(),
            "frequency": "1h",
        },
    )
    assert update_schedule.status_code == 201, update_schedule.text
    update_id = update_schedule.json()["id"]

    update_resp = client.patch(
        f"/v1/job-schedules/{update_id}",
        json={
            "job_type": "publish",
            "payload": {"instapaper_id": "insta-targeted"},
        },
    )
    assert update_resp.status_code == 400
    update_error = update_resp.json()
    assert update_error["details"]["error"] == "publish_schedule_conflict"


def test_create_publish_schedule_rejects_invalid_targets(client: TestClient):
    from app.db import get_session
    from app.models import Folder, Tag

    with next(get_session()) as session:
        foreign_tag = Tag(owner_user_id="other", name="Elsewhere")
        foreign_folder = Folder(owner_user_id="other", name="Foreign Folder")
        local_tag = Tag(owner_user_id="primary", name="Local")
        session.add(foreign_tag)
        session.add(foreign_folder)
        session.add(local_tag)
        session.commit()
        foreign_tag_id = foreign_tag.id
        foreign_folder_id = foreign_folder.id
        local_tag_id = local_tag.id

    invalid_tag_resp = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "publish-invalid-tag",
            "job_type": "publish",
            "payload": {"instapaper_id": "insta-tag"},
            "tags": [foreign_tag_id],
            "frequency": "1h",
        },
    )
    assert invalid_tag_resp.status_code == 400
    assert invalid_tag_resp.json()["details"]["error"] == "invalid_publish_tags"

    invalid_folder_resp = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "publish-invalid-folder",
            "job_type": "publish",
            "payload": {"instapaper_id": "insta-folder"},
            "tags": [local_tag_id],
            "folder_id": foreign_folder_id,
            "frequency": "1h",
        },
    )
    assert invalid_folder_resp.status_code == 400
    assert invalid_folder_resp.json()["details"]["error"] == "invalid_publish_folder"


def test_update_publish_schedule_tags_and_folder(client: TestClient):
    from app.db import get_session
    from app.models import Folder, Tag

    create_resp = client.post(
        "/v1/job-schedules",
        json={
            "schedule_name": "publish-update-tags",
            "job_type": "publish",
            "payload": {"instapaper_id": "insta-update"},
            "frequency": "3h",
        },
    )
    schedule_id = create_resp.json()["id"]

    with next(get_session()) as session:
        tag_one = Tag(owner_user_id="primary", name="Morning")
        tag_two = Tag(owner_user_id="primary", name="Evening")
        folder = Folder(owner_user_id="primary", name="Priority")
        session.add(tag_one)
        session.add(tag_two)
        session.add(folder)
        session.commit()
        tag_one_id = tag_one.id
        tag_two_id = tag_two.id
        folder_id = folder.id

    patch_resp = client.patch(
        f"/v1/job-schedules/{schedule_id}",
        json={"tags": [tag_one_id, tag_two_id], "folder_id": folder_id},
    )
    assert patch_resp.status_code == 200, patch_resp.text
    payload = patch_resp.json()
    assert payload["tags"] == [tag_one_id, tag_two_id]
    assert payload["folder_id"] == folder_id
    assert payload["payload"]["tags"] == [tag_one_id, tag_two_id]
    assert payload["payload"]["folder_id"] == folder_id


def test_rbac_enforcement(client: TestClient):
    from app.auth import ADMIN_ROLE_NAME, grant_role
    from app.db import get_session
    from app.models import JobSchedule

    with next(get_session()) as session:
        other_schedule = JobSchedule(
            schedule_name="other-schedule",
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

    list_default = client.get("/v1/job-schedules")
    assert list_default.status_code == 200
    assert list_default.json()["total"] == 0

    run_forbidden = client.post(f"/v1/job-schedules/{schedule_id}/run-now")
    assert run_forbidden.status_code == 403

    with next(get_session()) as session:
        grant_role(session, "primary", ADMIN_ROLE_NAME, granted_by_user_id="primary")
        session.commit()

    allowed_detail = client.get(f"/v1/job-schedules/{schedule_id}")
    assert allowed_detail.status_code == 200

    allowed_list = client.get("/v1/job-schedules")
    assert allowed_list.status_code == 200
    assert allowed_list.json()["total"] == 0

    allowed_run = client.post(f"/v1/job-schedules/{schedule_id}/run-now")
    assert allowed_run.status_code == 202
