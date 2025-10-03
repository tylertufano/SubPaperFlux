import os
import base64
import pytest
from fastapi.testclient import TestClient
from sqlmodel import select


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv(
        "CREDENTIALS_ENC_KEY", base64.urlsafe_b64encode(os.urandom(32)).decode()
    )
    monkeypatch.setenv("USER_MGMT_CORE", "1")
    from app.config import is_user_mgmt_core_enabled

    is_user_mgmt_core_enabled.cache_clear()


@pytest.fixture()
def client():
    from app.auth import ADMIN_ROLE_NAME, ensure_admin_role, grant_role
    from app.auth.oidc import get_current_user
    from app.db import get_session, init_db
    from app.main import create_app
    from app.models import User

    init_db()
    identity = {"sub": "u1", "groups": ["admin"], "email": "admin@example.com"}

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
                full_name="Admin User",
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


def test_unversioned_routes_removed(client):
    legacy_paths = [
        ("GET", "/site-configs"),
        ("GET", "/credentials"),
        ("GET", "/feeds"),
    ]

    for method, path in legacy_paths:
        response = client.request(method, path)
        assert response.status_code == 404, f"Expected 404 for legacy path {path}, got {response.status_code}"


def test_root_status_health_check(client):
    response = client.get("/status")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["version"] == "0.1.0"


def test_credentials_and_siteconfigs(client):
    from app.db import get_session
    from app.models import SiteConfig, SiteLoginType

    with next(get_session()) as session:
        user_site = SiteConfig(
            name="User Site",
            site_url="https://user.example.com/login",
            login_type=SiteLoginType.SELENIUM,
            selenium_config={
                "username_selector": "#username",
                "password_selector": "#password",
                "login_button_selector": "#submit",
                "cookies_to_store": ["sid"],
            },
            success_text_class="alert alert-user",
            expected_success_text="Welcome User Site",
            required_cookies=["sid", "csrf"],
            owner_user_id="u1",
        )
        api_user_site = SiteConfig(
            name="User API Site",
            site_url="https://api-user.example.com/login",
            login_type=SiteLoginType.API,
            api_config={
                "endpoint": "https://api-user.example.com/login",
                "method": "POST",
                "headers": {"X-Test": "1"},
            },
            success_text_class="toast toast-user",
            expected_success_text="API login complete",
            required_cookies=["api_session"],
            owner_user_id="u1",
        )
        global_site = SiteConfig(
            name="Global Site",
            site_url="https://global.example.com/login",
            login_type=SiteLoginType.SELENIUM,
            selenium_config={
                "username_selector": "#u",
                "password_selector": "#p",
                "login_button_selector": "button[type='submit']",
                "cookies_to_store": ["sid"],
            },
            success_text_class="alert alert-global",
            expected_success_text="Welcome Global User",
            required_cookies=["sid"],
            owner_user_id=None,
        )
        session.add(user_site)
        session.add(api_user_site)
        session.add(global_site)
        session.commit()
        session.refresh(user_site)
        session.refresh(api_user_site)
        session.refresh(global_site)

    # Create a credential (site_login)
    r = client.post(
        "/v1/credentials",
        json={
            "kind": "site_login",
            "description": "User credential",
            "data": {"username": "u", "password": "p"},
            "owner_user_id": "u1",
            "site_config_id": user_site.id,
        },
    )
    assert r.status_code == 201
    cred = r.json()
    assert cred["kind"] == "site_login"
    assert cred["description"] == "User credential"

    # Update credential
    r_update = client.put(
        f"/v1/credentials/{cred['id']}",
        json={
            "id": cred["id"],
            "kind": "site_login",
            "description": "Updated credential",
            "data": {"username": "u", "note": "updated"},
            "site_config_id": user_site.id,
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
    r_delete = client.delete(f"/v1/credentials/{cred['id']}")
    assert r_delete.status_code == 204

    r2_after = client.get("/v1/credentials")
    assert r2_after.status_code == 200
    assert r2_after.json()["total"] == 0

    # Creating a global credential that isn't instapaper_app should fail
    r_global_create = client.post(
        "/v1/credentials",
        json={
            "kind": "site_login",
            "description": "Global credential",
            "data": {"username": "ga", "password": "gp"},
            "owner_user_id": None,
            "site_config_id": global_site.id,
        },
    )
    assert r_global_create.status_code == 400
    error_body = r_global_create.json()
    assert error_body["status"] == 400
    assert "instapaper_app" in error_body["message"]

    # Admins can create global Instapaper app credentials
    r_global_create = client.post(
        "/v1/credentials",
        json={
            "kind": "instapaper_app",
            "description": "Global Instapaper app",
            "data": {"consumer_key": "ckey", "consumer_secret": "csecret"},
            "owner_user_id": None,
        },
    )
    assert r_global_create.status_code == 201
    global_cred = r_global_create.json()
    assert global_cred["owner_user_id"] is None
    assert global_cred["kind"] == "instapaper_app"
    assert global_cred["description"] == "Global Instapaper app"

    # Regular users should receive 403 when trying to delete a global credential
    from app.auth.oidc import get_current_user

    original_override = client.app.dependency_overrides[get_current_user]
    try:
        client.app.dependency_overrides[get_current_user] = lambda: {
            "sub": "u2",
            "groups": [],
        }
        r_forbidden_delete = client.delete(f"/v1/credentials/{global_cred['id']}")
        assert r_forbidden_delete.status_code == 403
    finally:
        client.app.dependency_overrides[get_current_user] = original_override

    # Ensure the credential still exists and admin can delete it
    r_global_detail = client.get(f"/v1/credentials/{global_cred['id']}")
    assert r_global_detail.status_code == 200
    assert r_global_detail.json()["description"] == "Global Instapaper app"

    r_global_delete = client.delete(f"/v1/credentials/{global_cred['id']}")
    assert r_global_delete.status_code == 204

    r_global_missing = client.get(f"/v1/credentials/{global_cred['id']}")
    assert r_global_missing.status_code == 404

    # Create a site config
    payload = {
        "name": "Demo",
        "site_url": "https://example.com/login",
        "login_type": "selenium",
        "selenium_config": {
            "username_selector": "#u",
            "password_selector": "#p",
            "login_button_selector": "button[type='submit']",
            "cookies_to_store": ["sid"],
        },
        "success_text_class": "alert alert-success",
        "expected_success_text": "Signed in as Demo",
        "required_cookies": ["sid", "csrf"],
    }
    r3 = client.post("/v1/site-configs", json=payload)
    assert r3.status_code == 201
    sc = r3.json()
    assert sc["name"] == "Demo"
    assert sc["selenium_config"]["username_selector"] == "#u"
    assert sc["success_text_class"] == payload["success_text_class"]
    assert sc["expected_success_text"] == payload["expected_success_text"]
    assert sc["required_cookies"] == payload["required_cookies"]

    # Update site config
    updated_payload = {
        **sc,
        "name": "Demo Updated",
        "selenium_config": {
            **sc["selenium_config"],
            "login_button_selector": "button.new",
        },
        "success_text_class": "alert alert-info",
        "expected_success_text": "You are logged in",
        "required_cookies": ["sid"],
    }
    r_update_sc = client.put(f"/v1/site-configs/{sc['id']}", json=updated_payload)
    assert r_update_sc.status_code == 200
    updated_response = r_update_sc.json()
    assert updated_response["name"] == "Demo Updated"
    assert updated_response["selenium_config"]["login_button_selector"] == "button.new"
    assert updated_response["success_text_class"] == "alert alert-info"
    assert updated_response["expected_success_text"] == "You are logged in"
    assert updated_response["required_cookies"] == ["sid"]

    # Delete site config
    r_delete_sc = client.delete(f"/v1/site-configs/{sc['id']}")
    assert r_delete_sc.status_code == 204

    # Create an API site config
    api_payload = {
        "name": "API Demo",
        "site_url": "https://api.example.com/login",
        "login_type": "api",
        "api_config": {
            "endpoint": "https://api.example.com/login",
            "method": "POST",
            "headers": {"X-Env": "prod"},
            "cookies": {"sid": "abc"},
        },
        "success_text_class": "toast toast-success",
        "expected_success_text": "API login ok",
        "required_cookies": ["sid"],
    }
    r_api = client.post("/v1/site-configs", json=api_payload)
    assert r_api.status_code == 201
    api_sc = r_api.json()
    assert api_sc["api_config"]["endpoint"] == "https://api.example.com/login"
    assert api_sc["success_text_class"] == api_payload["success_text_class"]
    assert api_sc["expected_success_text"] == api_payload["expected_success_text"]
    assert api_sc["required_cookies"] == api_payload["required_cookies"]

    api_update_payload = {
        **api_sc,
        "api_config": {
            **api_sc["api_config"],
            "method": "PUT",
            "headers": {"X-Env": "stage"},
        },
        "expected_success_text": "API login updated",
        "success_text_class": "toast toast-info",
        "required_cookies": ["sid", "refresh"],
    }
    r_api_update = client.put(f"/v1/site-configs/{api_sc['id']}", json=api_update_payload)
    assert r_api_update.status_code == 200
    assert r_api_update.json()["api_config"]["method"] == "PUT"
    assert r_api_update.json()["expected_success_text"] == "API login updated"
    assert r_api_update.json()["success_text_class"] == "toast toast-info"
    assert r_api_update.json()["required_cookies"] == ["sid", "refresh"]

    r_api_delete = client.delete(f"/v1/site-configs/{api_sc['id']}")
    assert r_api_delete.status_code == 204

    # List v1 site-configs
    r4 = client.get("/v1/site-configs")
    assert r4.status_code == 200
    scs = r4.json()
    assert scs["total"] == 3
    site_ids = {item["id"] for item in scs["items"]}
    assert user_site.id in site_ids
    assert api_user_site.id in site_ids
    assert global_site.id in site_ids

    # Verify audit logs recorded
    from app.db import get_session
    from app.models import AuditLog

    with next(get_session()) as session:
        cred_logs = session.exec(
            select(AuditLog)
            .where(AuditLog.entity_type == "credential")
            .order_by(AuditLog.created_at)
        ).all()
        actions = [log.action for log in cred_logs]
        assert actions == ["create", "update", "delete", "create", "delete"]
        setting_logs = session.exec(
            select(AuditLog)
            .where(AuditLog.entity_type == "setting")
            .order_by(AuditLog.created_at)
        ).all()
        assert [log.action for log in setting_logs] == [
            "create",
            "update",
            "delete",
            "create",
            "update",
            "delete",
        ]

    r_admin_audit = client.get("/v1/admin/audit")
    assert r_admin_audit.status_code == 200
    audit_payload = r_admin_audit.json()
    assert audit_payload["total"] >= 1
    assert audit_payload["items"]
    first_entry = audit_payload["items"][0]
    assert {"id", "entity_type", "action", "created_at"}.issubset(first_entry.keys())


def test_site_login_credential_inherits_site_config_owner(client):
    from app.db import get_session
    from app.models import Credential, SiteConfig, SiteLoginType

    subject_user = "subject-user"

    with next(get_session()) as session:
        subject_config = SiteConfig(
            name="Subject Site",
            site_url="https://subject.example.com/login",
            login_type=SiteLoginType.SELENIUM,
            selenium_config={
                "username_selector": "#user",
                "password_selector": "#pass",
                "login_button_selector": "#submit",
                "cookies_to_store": ["sid"],
            },
            success_text_class="alert alert-subject",
            expected_success_text="Logged in",
            required_cookies=["sid"],
            owner_user_id=subject_user,
        )
        session.add(subject_config)
        session.commit()
        session.refresh(subject_config)

    response = client.post(
        "/v1/credentials",
        json={
            "kind": "site_login",
            "description": "Subject credential",
            "data": {"username": "subject", "password": "pw"},
            "site_config_id": subject_config.id,
        },
    )

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["owner_user_id"] == subject_user

    with next(get_session()) as session:
        stored = session.get(Credential, payload["id"])
        assert stored is not None
        assert stored.owner_user_id == subject_user


def test_enforced_global_access_requires_permission(monkeypatch, client):
    monkeypatch.setenv("USER_MGMT_ENFORCE", "1")
    from app.config import is_user_mgmt_enforce_enabled

    is_user_mgmt_enforce_enabled.cache_clear()
    client.app.state.cache_user_mgmt_flags()
    try:
        cred_resp = client.post(
            "/v1/credentials",
            json={
                "kind": "instapaper_app",
                "description": "Global Instapaper app",
                "data": {"consumer_key": "ckey", "consumer_secret": "csecret"},
                "owner_user_id": None,
            },
        )
        assert cred_resp.status_code == 201
        global_cred = cred_resp.json()

        global_sc = _create_site_config(
            client,
            owner=None,
            name="Global Config",
            site_url="https://example.com/global",
        )

        from app.auth.oidc import get_current_user

        original_override = client.app.dependency_overrides[get_current_user]
        try:
            client.app.dependency_overrides[get_current_user] = lambda: {
                "sub": "tenant",
                "groups": [],
            }
            r_creds = client.get("/v1/credentials")
            assert r_creds.status_code == 403

            r_site_configs = client.get("/v1/site-configs")
            assert r_site_configs.status_code == 403

            r_cred_detail = client.get(f"/v1/credentials/{global_cred['id']}")
            assert r_cred_detail.status_code == 403

            r_sc_detail = client.get(f"/v1/site-configs/{global_sc['id']}")
            assert r_sc_detail.status_code == 403
        finally:
            client.app.dependency_overrides[get_current_user] = original_override
    finally:
        is_user_mgmt_enforce_enabled.cache_clear()


def test_enforced_cross_tenant_updates_require_permission(monkeypatch, client):
    monkeypatch.setenv("USER_MGMT_ENFORCE", "1")
    from app.config import is_user_mgmt_enforce_enabled

    is_user_mgmt_enforce_enabled.cache_clear()
    client.app.state.cache_user_mgmt_flags()
    try:
        owned_sc = _create_site_config(
            client,
            owner="u1",
            name="Owned Config",
            site_url="https://example.com/owned",
        )

        cred_resp = client.post(
            "/v1/credentials",
            json={
                "kind": "site_login",
                "description": "Owned credential",
                "data": {"username": "owner", "password": "secret"},
                "owner_user_id": "u1",
                "site_config_id": owned_sc["id"],
            },
        )
        assert cred_resp.status_code == 201
        owned_cred = cred_resp.json()

        from app.auth.oidc import get_current_user

        original_override = client.app.dependency_overrides[get_current_user]
        try:
            client.app.dependency_overrides[get_current_user] = lambda: {
                "sub": "tenant",
                "groups": [],
            }
            cred_update_payload = {
                "id": owned_cred["id"],
                "kind": owned_cred["kind"],
                "description": "Unauthorized update",
                "data": {"note": "denied"},
                "site_config_id": owned_sc["id"],
            }
            r_cred_update = client.put(
                f"/v1/credentials/{owned_cred['id']}", json=cred_update_payload
            )
            assert r_cred_update.status_code == 404

            sc_update_payload = dict(owned_sc)
            sc_update_payload["name"] = "Unauthorized"
            r_sc_update = client.put(
                f"/v1/site-configs/{owned_sc['id']}", json=sc_update_payload
            )
            assert r_sc_update.status_code == 403
        finally:
            client.app.dependency_overrides[get_current_user] = original_override

        tenant_sc = _create_site_config(
            client,
            owner="tenant",
            name="Tenant Config",
            site_url="https://example.com/tenant",
        )
        other_cred_resp = client.post(
            "/v1/credentials",
            json={
                "kind": "site_login",
                "description": "Tenant credential",
                "data": {"username": "tenant", "password": "pw"},
                "owner_user_id": "tenant",
                "site_config_id": tenant_sc["id"],
            },
        )
        assert other_cred_resp.status_code == 201
        tenant_cred = other_cred_resp.json()
        cred_update_payload = {
            "id": tenant_cred["id"],
            "kind": tenant_cred["kind"],
            "description": "Admin update",
            "data": {"note": "admin"},
            "site_config_id": tenant_sc["id"],
        }
        r_admin_cred_update = client.put(
            f"/v1/credentials/{tenant_cred['id']}", json=cred_update_payload
        )
        assert r_admin_cred_update.status_code == 200
        sc_update_payload = dict(tenant_sc)
        sc_update_payload["name"] = "Admin updated"
        r_admin_sc_update = client.put(
            f"/v1/site-configs/{tenant_sc['id']}", json=sc_update_payload
        )
        assert r_admin_sc_update.status_code == 200
    finally:
        is_user_mgmt_enforce_enabled.cache_clear()


def test_admin_feed_creation_defaults_to_requester(client):
    resp = client.post(
        "/v1/feeds/",
        json={"url": "https://example.com/feed"},
    )
    assert resp.status_code == 201
    payload = resp.json()
    assert payload["owner_user_id"] == "u1"

    from app.db import get_session
    from app.models import Feed

    with next(get_session()) as session:
        stored = session.get(Feed, payload["id"])
        assert stored is not None
        assert stored.owner_user_id == "u1"


def _create_site_config(
    client,
    *,
    owner: str | None = "u1",
    name: str = "Example Site",
    site_url: str = "https://example.com",
) -> dict:
    payload = {
        "name": name,
        "site_url": site_url,
        "login_type": "selenium",
        "selenium_config": {
            "username_selector": "#user",
            "password_selector": "#pass",
            "login_button_selector": "button[type=submit]",
            "cookies_to_store": ["sid"],
        },
        "success_text_class": "alert alert-owner" if owner else "alert alert-global",
        "expected_success_text": "Logged in successfully",
        "required_cookies": ["sid"],
        "owner_user_id": owner,
    }
    resp = client.post("/v1/site-configs", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_site_login_credential(
    client, *, site_config_id: str, owner: str = "u1"
) -> dict:
    payload = {
        "kind": "site_login",
        "description": f"Login for {owner}",
        "data": {"username": owner, "password": "pw"},
        "owner_user_id": owner,
        "site_config_id": site_config_id,
    }
    resp = client.post("/v1/credentials", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_feed_creation_with_site_login_credential(client):
    site_config = _create_site_config(client)
    credential = _create_site_login_credential(client, site_config_id=site_config["id"])

    resp = client.post(
        "/v1/feeds/",
        json={
            "url": "https://example.com/paywalled.xml",
            "site_login_credential_id": credential["id"],
        },
    )
    assert resp.status_code == 201, resp.text
    payload = resp.json()
    assert payload["site_login_credential_id"] == credential["id"]
    assert payload["site_config_id"] == site_config["id"]

    from app.db import get_session
    from app.models import Feed

    with next(get_session()) as session:
        stored = session.get(Feed, payload["id"])
        assert stored is not None
        assert stored.site_login_credential_id == credential["id"]
        assert stored.site_config_id == site_config["id"]


def test_feed_update_allows_switching_site_login_credential(client):
    site_config = _create_site_config(client)
    first_cred = _create_site_login_credential(client, site_config_id=site_config["id"])
    second_cred = _create_site_login_credential(
        client, site_config_id=site_config["id"]
    )

    create_resp = client.post(
        "/v1/feeds/",
        json={
            "url": "https://example.com/primary.xml",
            "site_login_credential_id": first_cred["id"],
        },
    )
    assert create_resp.status_code == 201
    feed = create_resp.json()

    update_resp = client.put(
        f"/v1/feeds/{feed['id']}",
        json={
            "id": feed["id"],
            "url": str(feed["url"]),
            "poll_frequency": feed.get("poll_frequency") or "1h",
            "initial_lookback_period": feed.get("initial_lookback_period"),
            "is_paywalled": feed.get("is_paywalled", False),
            "rss_requires_auth": feed.get("rss_requires_auth", False),
            "site_login_credential_id": second_cred["id"],
        },
    )
    assert update_resp.status_code == 200, update_resp.text
    updated = update_resp.json()
    assert updated["site_login_credential_id"] == second_cred["id"]
    assert updated["site_config_id"] == site_config["id"]

    from app.db import get_session
    from app.models import Feed

    with next(get_session()) as session:
        stored = session.get(Feed, feed["id"])
        assert stored is not None
        assert stored.site_login_credential_id == second_cred["id"]


def test_feed_creation_rejects_mismatched_site_login_configuration(client):
    site_config = _create_site_config(client)
    other_config = _create_site_config(client, owner="u2")
    credential = _create_site_login_credential(client, site_config_id=site_config["id"])

    resp = client.post(
        "/v1/feeds/",
        json={
            "url": "https://example.com/invalid.xml",
            "site_login_credential_id": credential["id"],
            "site_config_id": other_config["id"],
        },
    )
    assert resp.status_code == 422
    assert "site_config_id" in resp.text or "site_login_credential_id" in resp.text


def test_instapaper_login_success(monkeypatch, client):
    from app.db import get_session
    from app.models import AuditLog, Credential
    from app.security.crypto import encrypt_dict, decrypt_dict
    import app.integrations.instapaper as instapaper
    import app.routers.credentials_v1 as credentials_router

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
        "/v1/credentials/instapaper/login",
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
        stored = session.exec(
            select(Credential).where(Credential.kind == "instapaper")
        ).first()
        assert stored is not None
        plain = decrypt_dict(stored.data)
        assert plain["oauth_token"] == "tok123456789"
        assert plain["oauth_token_secret"] == "sec987654321"
        assert plain["username"] == "reader@example.com"
        logs = session.exec(
            select(AuditLog).where(AuditLog.entity_id == stored.id)
        ).all()
        assert any(log.action == "create" for log in logs)


def test_instapaper_login_cannot_be_global(monkeypatch, client):
    from app.db import get_session
    from app.models import Credential
    from app.security.crypto import encrypt_dict
    import app.integrations.instapaper as instapaper
    import app.routers.credentials_v1 as credentials_router

    with next(get_session()) as session:
        session.add(
            Credential(
                kind="instapaper_app",
                description="Instapaper app",
                data=encrypt_dict(
                    {"consumer_key": "ckey", "consumer_secret": "csecret"}
                ),
                owner_user_id=None,
            )
        )
        session.commit()

    called = False

    def fail(*args, **kwargs):  # pragma: no cover - should not be called
        nonlocal called
        called = True
        return instapaper.InstapaperTokenResponse(
            success=True,
            oauth_token="tok",
            oauth_token_secret="sec",
            status_code=200,
        )

    monkeypatch.setattr(credentials_router, "get_instapaper_tokens", fail)

    resp = client.post(
        "/v1/credentials/instapaper/login",
        json={
            "description": "Instapaper",
            "username": "reader@example.com",
            "password": "pw",
            "scope_global": True,
        },
    )
    assert resp.status_code == 400
    error_body = resp.json()
    assert error_body["status"] == 400
    assert "cannot be global" in error_body["message"]
    assert called is False

    with next(get_session()) as session:
        stored = session.exec(
            select(Credential).where(Credential.kind == "instapaper")
        ).all()
        assert stored == []


def test_instapaper_login_missing_app_creds(monkeypatch, client):
    import app.integrations.instapaper as instapaper
    import app.routers.credentials_v1 as credentials_router

    def fail(*args, **kwargs):  # pragma: no cover - should not be called
        raise AssertionError(
            "get_instapaper_tokens should not be invoked without app creds"
        )

    monkeypatch.setattr(credentials_router, "get_instapaper_tokens", fail)

    resp = client.post(
        "/v1/credentials/instapaper/login",
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
    import app.routers.credentials_v1 as credentials_router

    with next(get_session()) as session:
        session.add(
            Credential(
                kind="instapaper_app",
                description="app",
                data=encrypt_dict(
                    {"consumer_key": "ckey", "consumer_secret": "csecret"}
                ),
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
        "/v1/credentials/instapaper/login",
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
        stored = session.exec(
            select(Credential).where(Credential.kind == "instapaper")
        ).first()
        assert stored is None


def test_jobs_validation(client):
    # Missing fields
    r = client.post("/v1/jobs/validate", json={"type": "login", "payload": {}})
    assert r.status_code == 200
    assert r.json()["ok"] is False
    # Provide required
    r2 = client.post(
        "/v1/jobs/validate",
        json={
            "type": "login",
            "payload": {"site_login_pair": "cred-1::site-1"},
        },
    )
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
