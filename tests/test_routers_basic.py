import os
import base64
import pytest
from fastapi.testclient import TestClient
from sqlmodel import select


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("CREDENTIALS_ENC_KEY", base64.urlsafe_b64encode(os.urandom(32)).decode())
    monkeypatch.setenv("USER_MGMT_CORE", "1")
    from app.config import is_user_mgmt_core_enabled

    is_user_mgmt_core_enabled.cache_clear()


@pytest.fixture()
def client():
    from app.main import create_app
    from app.db import init_db
    from app.auth.oidc import get_current_user
    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u1", "groups": ["admin"]}
    return TestClient(app)


def test_credentials_and_siteconfigs(client):
    # Create a credential (site_login)
    r = client.post(
        "/credentials",
        json={"kind": "site_login", "data": {"username": "u", "password": "p"}, "owner_user_id": "u1"},
    )
    assert r.status_code == 201
    cred = r.json()
    assert cred["kind"] == "site_login"

    # Update credential
    r_update = client.put(
        f"/credentials/{cred['id']}",
        json={"id": cred["id"], "kind": "site_login", "data": {"username": "u", "note": "updated"}},
    )
    assert r_update.status_code == 200

    # List v1 credentials
    r2 = client.get("/v1/credentials")
    assert r2.status_code == 200
    data = r2.json()
    assert data["total"] >= 1

    # Delete credential
    r_delete = client.delete(f"/credentials/{cred['id']}")
    assert r_delete.status_code == 204

    r2_after = client.get("/v1/credentials")
    assert r2_after.status_code == 200
    assert r2_after.json()["total"] == 0

    # Create a global credential as admin
    r_global_create = client.post(
        "/credentials",
        json={"kind": "site_login", "data": {"username": "ga", "password": "gp"}, "owner_user_id": None},
    )
    assert r_global_create.status_code == 201
    global_cred = r_global_create.json()
    assert global_cred["owner_user_id"] is None

    # Regular users should receive 404 when trying to delete a global credential
    from app.auth.oidc import get_current_user

    original_override = client.app.dependency_overrides[get_current_user]
    try:
        client.app.dependency_overrides[get_current_user] = lambda: {"sub": "u2", "groups": []}
        r_forbidden_delete = client.delete(f"/credentials/{global_cred['id']}")
        assert r_forbidden_delete.status_code == 404
    finally:
        client.app.dependency_overrides[get_current_user] = original_override

    # Ensure the credential still exists and admin can delete it
    r_global_detail = client.get(f"/credentials/{global_cred['id']}")
    assert r_global_detail.status_code == 200

    r_global_delete = client.delete(f"/credentials/{global_cred['id']}")
    assert r_global_delete.status_code == 204

    r_global_missing = client.get(f"/credentials/{global_cred['id']}")
    assert r_global_missing.status_code == 404

    # Create a site config
    payload = {
        "name": "Demo",
        "site_url": "https://example.com/login",
        "username_selector": "#u",
        "password_selector": "#p",
        "login_button_selector": "button[type='submit']",
        "cookies_to_store": ["sid"],
    }
    r3 = client.post("/site-configs", json=payload)
    assert r3.status_code == 201
    sc = r3.json()
    assert sc["name"] == "Demo"

    # Update site config
    updated_payload = dict(sc)
    updated_payload["name"] = "Demo Updated"
    r_update_sc = client.put(f"/site-configs/{sc['id']}", json=updated_payload)
    assert r_update_sc.status_code == 200
    assert r_update_sc.json()["name"] == "Demo Updated"

    # Delete site config
    r_delete_sc = client.delete(f"/site-configs/{sc['id']}")
    assert r_delete_sc.status_code == 204

    # List v1 site-configs
    r4 = client.get("/v1/site-configs")
    assert r4.status_code == 200
    scs = r4.json()
    assert scs["total"] == 0

    # Verify audit logs recorded
    from app.db import get_session
    from app.models import AuditLog

    with next(get_session()) as session:
        cred_logs = session.exec(
            select(AuditLog).where(AuditLog.entity_type == "credential").order_by(AuditLog.created_at)
        ).all()
        actions = [log.action for log in cred_logs]
        assert actions == ["create", "update", "delete", "create", "delete"]
        setting_logs = session.exec(
            select(AuditLog).where(AuditLog.entity_type == "setting").order_by(AuditLog.created_at)
        ).all()
        assert [log.action for log in setting_logs] == ["create", "update", "delete"]

    r_admin_audit = client.get("/v1/admin/audit")
    assert r_admin_audit.status_code == 200
    audit_payload = r_admin_audit.json()
    assert audit_payload["total"] >= 1
    assert audit_payload["items"]
    first_entry = audit_payload["items"][0]
    assert {"id", "entity_type", "action", "created_at"}.issubset(first_entry.keys())


def test_jobs_validation(client):
    # Missing fields
    r = client.post("/v1/jobs/validate", json={"type": "login", "payload": {}})
    assert r.status_code == 200
    assert r.json()["ok"] is False
    # Provide required
    r2 = client.post("/v1/jobs/validate", json={"type": "login", "payload": {"config_dir": ".", "site_config_id": "a", "credential_id": "b"}})
    assert r2.status_code == 200
    assert r2.json()["ok"] is True


def test_admin_audit_requires_admin():
    from app.main import create_app
    from app.db import init_db
    from app.auth.oidc import get_current_user

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u2", "groups": []}
    client = TestClient(app)

    resp = client.get("/v1/admin/audit")
    assert resp.status_code == 403

