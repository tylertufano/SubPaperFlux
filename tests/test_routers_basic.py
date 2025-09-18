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
        json={
            "kind": "site_login",
            "description": "User credential",
            "data": {"username": "u", "password": "p"},
            "owner_user_id": "u1",
        },
    )
    assert r.status_code == 201
    cred = r.json()
    assert cred["kind"] == "site_login"
    assert cred["description"] == "User credential"

    # Update credential
    r_update = client.put(
        f"/credentials/{cred['id']}",
        json={
            "id": cred["id"],
            "kind": "site_login",
            "description": "Updated credential",
            "data": {"username": "u", "note": "updated"},
        },
    )
    assert r_update.status_code == 200
    assert r_update.json()["description"] == "Updated credential"

    # List v1 credentials
    r2 = client.get("/v1/credentials")
    assert r2.status_code == 200
    data = r2.json()
    assert data["total"] >= 1
    assert any(item["description"] == "Updated credential" for item in data["items"])

    # Delete credential
    r_delete = client.delete(f"/credentials/{cred['id']}")
    assert r_delete.status_code == 204

    r2_after = client.get("/v1/credentials")
    assert r2_after.status_code == 200
    assert r2_after.json()["total"] == 0

    # Create a global credential as admin
    r_global_create = client.post(
        "/credentials",
        json={
            "kind": "site_login",
            "description": "Global credential",
            "data": {"username": "ga", "password": "gp"},
            "owner_user_id": None,
        },
    )
    assert r_global_create.status_code == 201
    global_cred = r_global_create.json()
    assert global_cred["owner_user_id"] is None
    assert global_cred["description"] == "Global credential"

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
    assert r_global_detail.json()["description"] == "Global credential"

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


def test_instapaper_login_success(monkeypatch, client):
    from app.db import get_session
    from app.models import AuditLog, Credential
    from app.security.crypto import encrypt_dict, decrypt_dict
    import app.integrations.instapaper as instapaper
    import app.routers.credentials as credentials_router

    def fake_get_tokens(consumer_key, consumer_secret, username, password):
        assert consumer_key == "ckey"
        assert consumer_secret == "csecret"
        assert username == "reader@example.com"
        assert password == "pw"
        return instapaper.InstapaperTokenResponse(
            success=True,
            oauth_token="tok123456789",
            oauth_token_secret="sec987654321",
            status_code=200,
        )

    monkeypatch.setattr(credentials_router, "get_instapaper_tokens", fake_get_tokens)

    with next(get_session()) as session:
        app_cred = Credential(
            kind="instapaper_app",
            description="Instapaper app",
            data=encrypt_dict({"consumer_key": "ckey", "consumer_secret": "csecret"}),
            owner_user_id=None,
        )
        session.add(app_cred)
        session.commit()

    resp = client.post(
        "/credentials/instapaper/login",
        json={
            "description": "My Instapaper",
            "username": "reader@example.com",
            "password": "pw",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["kind"] == "instapaper"
    assert body["description"] == "My Instapaper"
    assert body["owner_user_id"] == "u1"
    assert body["data"]["username"] == "reader@example.com"
    assert "***" in body["data"]["oauth_token"]
    assert body["data"]["oauth_token"] != "tok123456789"
    assert body["data"]["oauth_token_secret"] != "sec987654321"

    with next(get_session()) as session:
        stored = session.exec(select(Credential).where(Credential.kind == "instapaper")).first()
        assert stored is not None
        plain = decrypt_dict(stored.data)
        assert plain["oauth_token"] == "tok123456789"
        assert plain["oauth_token_secret"] == "sec987654321"
        assert plain["username"] == "reader@example.com"
        logs = session.exec(select(AuditLog).where(AuditLog.entity_id == stored.id)).all()
        assert any(log.action == "create" for log in logs)


def test_instapaper_login_missing_app_creds(monkeypatch, client):
    import app.integrations.instapaper as instapaper
    import app.routers.credentials as credentials_router

    def fail(*args, **kwargs):  # pragma: no cover - should not be called
        raise AssertionError("get_instapaper_tokens should not be invoked without app creds")

    monkeypatch.setattr(credentials_router, "get_instapaper_tokens", fail)

    resp = client.post(
        "/credentials/instapaper/login",
        json={
            "description": "Instapaper",
            "username": "reader@example.com",
            "password": "pw",
        },
    )
    assert resp.status_code == 400
    error_body = resp.json()
    assert error_body["status"] == 400
    assert error_body["message"] == "Instapaper app credentials are not configured"


def test_instapaper_login_bad_password(monkeypatch, client):
    from app.db import get_session
    from app.models import Credential
    from app.security.crypto import encrypt_dict
    import app.integrations.instapaper as instapaper
    import app.routers.credentials as credentials_router

    with next(get_session()) as session:
        session.add(
            Credential(
                kind="instapaper_app",
                description="app",
                data=encrypt_dict({"consumer_key": "ckey", "consumer_secret": "csecret"}),
                owner_user_id=None,
            )
        )
        session.commit()

    monkeypatch.setattr(
        credentials_router,
        "get_instapaper_tokens",
        lambda *args, **kwargs: instapaper.InstapaperTokenResponse(
            success=False,
            error="invalid",
            status_code=403,
        ),
    )

    resp = client.post(
        "/credentials/instapaper/login",
        json={
            "description": "Instapaper",
            "username": "reader@example.com",
            "password": "bad",
        },
    )
    assert resp.status_code == 400
    error_body = resp.json()
    assert error_body["status"] == 400
    assert error_body["message"] == "Invalid Instapaper username or password"

    with next(get_session()) as session:
        stored = session.exec(select(Credential).where(Credential.kind == "instapaper")).first()
        assert stored is None


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

