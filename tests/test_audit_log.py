import base64
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv(
        "CREDENTIALS_ENC_KEY", base64.urlsafe_b64encode(os.urandom(32)).decode()
    )
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.setenv("USER_MGMT_CORE", "1")
    from app.config import is_user_mgmt_core_enabled

    is_user_mgmt_core_enabled.cache_clear()


@pytest.fixture()
def admin_client():
    from app.auth import ADMIN_ROLE_NAME, ensure_admin_role, grant_role
    from app.auth.oidc import get_current_user
    from app.db import get_session, init_db
    from app.main import create_app
    from app.models import User

    init_db()
    identity = {"sub": "admin", "groups": ["admin"], "email": "admin@example.com"}

    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: identity
    client = TestClient(app)
    with next(get_session()) as session:
        ensure_admin_role(session)
        session.commit()
        admin_user = session.get(User, identity["sub"])
        if admin_user is None:
            admin_user = User(
                id=identity["sub"],
                email=identity.get("email"),
                full_name="Admin",  # minimal metadata for tests
                claims={"groups": identity.get("groups", [])},
            )
        if session.get(User, admin_user.id) is None:
            session.add(admin_user)
            session.commit()
        grant_role(
            session,
            admin_user.id,
            ADMIN_ROLE_NAME,
            granted_by_user_id=admin_user.id,
        )
        session.commit()
    return client


def fetch_audit(client: TestClient, **params):
    response = client.get("/v1/admin/audit", params=params)
    assert response.status_code == 200
    return response.json()


def test_audit_log_tracks_credential_crud(admin_client: TestClient):
    from app.db import get_session
    from app.models import SiteConfig, SiteLoginType

    with next(get_session()) as session:
        site_config = SiteConfig(
            name="Audit Site",
            site_url="https://audit.example.com/login",
            login_type=SiteLoginType.SELENIUM,
            selenium_config={
                "username_selector": "#username",
                "password_selector": "#password",
                "login_button_selector": "#submit",
                "cookies_to_store": ["session"],
            },
            success_text_class="alert alert-audit",
            expected_success_text="Audit success",
            required_cookies=["session"],
            owner_user_id="admin",
        )
        session.add(site_config)
        session.commit()
        session.refresh(site_config)
        site_config_id = site_config.id

    create_payload = {
        "kind": "site_login",
        "description": "Initial credential",
        "data": {"username": "demo", "password": "secret"},
        "owner_user_id": "admin",
        "site_config_id": site_config_id,
    }
    created = admin_client.post("/v1/credentials", json=create_payload)
    assert created.status_code == 201
    cred = created.json()

    logs_after_create = fetch_audit(
        admin_client, entity_type="credential", entity_id=cred["id"], size=10
    )
    assert logs_after_create["total"] == 1
    assert logs_after_create["items"][0]["action"] == "create"
    assert logs_after_create["items"][0]["entity_id"] == cred["id"]

    update_payload = {
        "id": cred["id"],
        "kind": "site_login",
        "description": "Refreshed credential",
        "data": {"username": "demo", "note": "refreshed"},
        "owner_user_id": "admin",
        "site_config_id": site_config_id,
    }
    updated = admin_client.put(f"/v1/credentials/{cred['id']}", json=update_payload)
    assert updated.status_code == 200

    logs_after_update = fetch_audit(
        admin_client, entity_type="credential", entity_id=cred["id"], size=10
    )
    assert logs_after_update["total"] == 2
    assert [item["action"] for item in logs_after_update["items"][:2]] == [
        "update",
        "create",
    ]

    deleted = admin_client.delete(f"/v1/credentials/{cred['id']}")
    assert deleted.status_code == 204

    final_logs = fetch_audit(
        admin_client, entity_type="credential", entity_id=cred["id"], size=10
    )
    assert final_logs["total"] == 3
    assert [item["action"] for item in final_logs["items"][:3]] == [
        "delete",
        "update",
        "create",
    ]
    assert all(entry["entity_id"] == cred["id"] for entry in final_logs["items"])
    assert final_logs["items"][0]["details"]["kind"] == "site_login"
    assert final_logs["items"][0]["details"]["description"] == "Refreshed credential"


def test_audit_log_tracks_site_config_crud(admin_client: TestClient):
    create_payload = {
        "name": "Demo Site",
        "site_url": "https://example.com/login",
        "login_type": "selenium",
        "selenium_config": {
            "username_selector": "#username",
            "password_selector": "#password",
            "login_button_selector": "button[type='submit']",
            "cookies_to_store": ["session"],
        },
        "success_text_class": "alert alert-audit",
        "expected_success_text": "Demo success",
        "required_cookies": ["session"],
    }
    created = admin_client.post("/v1/site-configs", json=create_payload)
    assert created.status_code == 201
    site_config = created.json()

    logs_after_create = fetch_audit(
        admin_client, entity_type="setting", entity_id=site_config["id"], size=10
    )
    assert logs_after_create["total"] == 1
    assert logs_after_create["items"][0]["action"] == "create"

    updated_payload = dict(site_config)
    updated_payload["name"] = "Demo Site Updated"
    updated = admin_client.put(
        f"/v1/site-configs/{site_config['id']}",
        json=updated_payload,
    )
    assert updated.status_code == 200

    logs_after_update = fetch_audit(
        admin_client, entity_type="setting", entity_id=site_config["id"], size=10
    )
    assert logs_after_update["total"] == 2
    assert [item["action"] for item in logs_after_update["items"][:2]] == [
        "update",
        "create",
    ]

    deleted = admin_client.delete(f"/v1/site-configs/{site_config['id']}")
    assert deleted.status_code == 204

    final_logs = fetch_audit(
        admin_client, entity_type="setting", entity_id=site_config["id"], size=10
    )
    assert final_logs["total"] == 3
    assert [item["action"] for item in final_logs["items"][:3]] == [
        "delete",
        "update",
        "create",
    ]
    assert all(entry["entity_id"] == site_config["id"] for entry in final_logs["items"])
    assert final_logs["items"][0]["details"]["name"] == "Demo Site Updated"
    assert final_logs["items"][2]["details"]["name"] == "Demo Site"


def test_audit_log_tracks_bookmark_deletes(admin_client: TestClient):
    from app.db import get_session
    from app.models import Bookmark

    with next(get_session()) as session:
        bookmark = Bookmark(
            owner_user_id="admin",
            instapaper_bookmark_id="insta-001",
            title="Audit Bookmark",
            url="https://example.com/audit",
            published_at=datetime.now(timezone.utc),
        )
        session.add(bookmark)
        session.commit()
        bookmark_id = bookmark.id

    delete_response = admin_client.delete(
        f"/v1/bookmarks/{bookmark_id}",
        params={"delete_remote": "false"},
    )
    assert delete_response.status_code == 204

    final_logs = fetch_audit(
        admin_client,
        entity_type="bookmark",
        entity_id=bookmark_id,
        size=10,
    )
    assert final_logs["total"] >= 1
    assert final_logs["items"][0]["action"] == "delete"
    assert final_logs["items"][0]["details"]["delete_remote"] is False
    assert final_logs["items"][0]["details"]["instapaper_bookmark_id"] == "insta-001"
