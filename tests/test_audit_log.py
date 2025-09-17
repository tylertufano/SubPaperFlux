import base64
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv(
        "CREDENTIALS_ENC_KEY", base64.urlsafe_b64encode(os.urandom(32)).decode()
    )
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))


@pytest.fixture()
def admin_client():
    from app.main import create_app
    from app.db import init_db
    from app.auth.oidc import get_current_user

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "admin", "groups": ["admin"]}
    return TestClient(app)


def fetch_audit(client: TestClient, **params):
    response = client.get("/v1/admin/audit", params=params)
    assert response.status_code == 200
    return response.json()


def test_audit_log_tracks_credential_crud(admin_client: TestClient):
    create_payload = {
        "kind": "site_login",
        "data": {"username": "demo", "password": "secret"},
        "owner_user_id": "admin",
    }
    created = admin_client.post("/credentials", json=create_payload)
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
        "data": {"username": "demo", "note": "refreshed"},
        "owner_user_id": "admin",
    }
    updated = admin_client.put(f"/credentials/{cred['id']}", json=update_payload)
    assert updated.status_code == 200

    logs_after_update = fetch_audit(
        admin_client, entity_type="credential", entity_id=cred["id"], size=10
    )
    assert logs_after_update["total"] == 2
    assert [item["action"] for item in logs_after_update["items"][:2]] == [
        "update",
        "create",
    ]

    deleted = admin_client.delete(f"/credentials/{cred['id']}")
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


def test_audit_log_tracks_site_config_crud(admin_client: TestClient):
    create_payload = {
        "name": "Demo Site",
        "site_url": "https://example.com/login",
        "username_selector": "#username",
        "password_selector": "#password",
        "login_button_selector": "button[type='submit']",
        "cookies_to_store": ["session"],
    }
    created = admin_client.post("/site-configs", json=create_payload)
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
        f"/site-configs/{site_config['id']}",
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

    deleted = admin_client.delete(f"/site-configs/{site_config['id']}")
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


def test_audit_log_tracks_bookmark_updates_and_deletes(admin_client: TestClient):
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

    update_response = admin_client.put(
        f"/bookmarks/{bookmark_id}/tags",
        json={"tags": ["alpha", "beta"]},
    )
    assert update_response.status_code == 200

    logs_after_update = fetch_audit(
        admin_client,
        entity_type="bookmark",
        entity_id=bookmark_id,
        size=10,
    )
    assert logs_after_update["total"] >= 1
    assert logs_after_update["items"][0]["action"] == "update"
    assert logs_after_update["items"][0]["entity_id"] == bookmark_id
    assert logs_after_update["items"][0]["details"]["tags"] == ["alpha", "beta"]

    delete_response = admin_client.delete(
        f"/bookmarks/{bookmark_id}",
        params={"delete_remote": "false"},
    )
    assert delete_response.status_code == 204

    final_logs = fetch_audit(
        admin_client,
        entity_type="bookmark",
        entity_id=bookmark_id,
        size=10,
    )
    assert final_logs["total"] >= 2
    assert [item["action"] for item in final_logs["items"][:2]] == [
        "delete",
        "update",
    ]
    assert final_logs["items"][0]["details"]["delete_remote"] is False
    assert final_logs["items"][0]["details"]["instapaper_bookmark_id"] == "insta-001"
    assert final_logs["items"][1]["details"]["tags"] == ["alpha", "beta"]
