from __future__ import annotations

import base64
import os
from pathlib import Path
from types import SimpleNamespace
from typing import Optional

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.setenv("USER_MGMT_CORE", "1")
    monkeypatch.setenv("USER_MGMT_ENFORCE", "0")
    monkeypatch.setenv(
        "CREDENTIALS_ENC_KEY",
        base64.urlsafe_b64encode(os.urandom(32)).decode(),
    )

    from app.config import is_user_mgmt_core_enabled, is_user_mgmt_enforce_enabled

    is_user_mgmt_core_enabled.cache_clear()
    is_user_mgmt_enforce_enabled.cache_clear()
    try:
        yield
    finally:
        is_user_mgmt_core_enabled.cache_clear()
        is_user_mgmt_enforce_enabled.cache_clear()


@pytest.fixture(
    params=[False, True], ids=["enforcement_disabled", "enforcement_enabled"]
)
def api_context(request, monkeypatch):
    enforce_enabled: bool = request.param
    if enforce_enabled:
        monkeypatch.setenv("USER_MGMT_ENFORCE", "1")
    else:
        monkeypatch.setenv("USER_MGMT_ENFORCE", "0")

    from app.config import is_user_mgmt_enforce_enabled

    is_user_mgmt_enforce_enabled.cache_clear()

    from app.auth import ADMIN_ROLE_NAME, ensure_admin_role, grant_role, get_user_roles
    from app.auth.oidc import get_current_user
    from app.db import get_session, init_db
    from app.main import create_app
    from app.models import Credential, Feed, SiteConfig, SiteLoginType, Tag, User
    from app.security.crypto import encrypt_dict

    init_db()
    app = create_app()
    client = TestClient(app)
    client.app.state.cache_user_mgmt_flags()

    owner_identity = {
        "sub": "owner-1",
        "email": "owner@example.com",
        "name": "Owner One",
        "groups": [],
    }
    admin_identity = {
        "sub": "admin-1",
        "email": "admin@example.com",
        "name": "Admin User",
        "groups": ["admin"],
    }
    guest_identity = {
        "sub": "guest-1",
        "email": "guest@example.com",
        "name": "Guest User",
        "groups": [],
    }

    with next(get_session()) as session:
        ensure_admin_role(session)
        session.commit()

        def ensure_user(identity):
            user = session.get(User, identity["sub"])
            if user is None:
                session.add(
                    User(
                        id=identity["sub"],
                        email=identity.get("email"),
                        full_name=identity.get("name"),
                        claims={"groups": identity.get("groups", [])},
                    )
                )

        for identity in (owner_identity, admin_identity, guest_identity):
            ensure_user(identity)
        session.commit()

        grant_role(
            session,
            admin_identity["sub"],
            ADMIN_ROLE_NAME,
            granted_by_user_id=admin_identity["sub"],
        )
        session.commit()
        assert ADMIN_ROLE_NAME in get_user_roles(session, admin_identity["sub"])

        admin_config = SiteConfig(
            name="Admin Config",
            site_url="https://admin.example.com/login",
            login_type=SiteLoginType.SELENIUM,
            selenium_config={
                "username_selector": "#username",
                "password_selector": "#password",
                "login_button_selector": "#login",
            },
            success_text_class="alert alert-admin",
            expected_success_text="Admin success",
            required_cookies=["session"],
            owner_user_id=admin_identity["sub"],
        )
        owner_config = SiteConfig(
            name="Owner Config",
            site_url="https://owner.example.com/login",
            login_type=SiteLoginType.SELENIUM,
            selenium_config={
                "username_selector": "#username",
                "password_selector": "#password",
                "login_button_selector": "#login",
            },
            success_text_class="alert alert-owner",
            expected_success_text="Owner success",
            required_cookies=["session"],
            owner_user_id=owner_identity["sub"],
        )
        session.add(admin_config)
        session.add(owner_config)
        admin_config_id = admin_config.id
        owner_config_id = owner_config.id

        global_credential = Credential(
            kind="instapaper_app",
            description="Global App",
            data=encrypt_dict(
                {"consumer_key": "ckey", "consumer_secret": "csecret"}
            ),
            owner_user_id=None,
        )
        owner_credential = Credential(
            kind="site_login",
            description="Owner Login",
            data={"username": "owner", "password": "example"},
            owner_user_id=owner_identity["sub"],
            site_config_id=owner_config_id,
        )
        session.add(global_credential)
        session.add(owner_credential)
        global_credential_id = global_credential.id
        owner_credential_id = owner_credential.id

        session.add(
            Feed(
                url="https://example.com/feeds/seed-owner.xml",
                poll_frequency="1h",
                owner_user_id=owner_identity["sub"],
            )
        )

        owner_tag = Tag(owner_user_id=owner_identity["sub"], name="Owner Tag")
        session.add(owner_tag)
        owner_tag_id = owner_tag.id

        session.commit()

    def request_as(identity, method: str, path: str, **kwargs):
        app.dependency_overrides[get_current_user] = lambda: identity
        try:
            http_method = method.lower()
            return getattr(client, http_method)(path, **kwargs)
        finally:
            app.dependency_overrides.pop(get_current_user, None)

    context = SimpleNamespace(
        enforce=enforce_enabled,
        request_as=request_as,
        owner=owner_identity,
        admin=admin_identity,
        guest=guest_identity,
        owner_site_config_id=owner_config_id,
        other_site_config_id=admin_config_id,
        owner_credential_id=owner_credential_id,
        global_credential_id=global_credential_id,
        owner_tag_id=owner_tag_id,
    )

    try:
        yield context
    finally:
        app.dependency_overrides.clear()
        client.close()


def test_site_config_access_controls(api_context):
    context = api_context

    owner_resp = context.request_as(
        context.owner,
        "GET",
        f"/v1/site-configs/{context.owner_site_config_id}",
    )
    assert owner_resp.status_code == 200
    assert owner_resp.json()["owner_user_id"] == context.owner["sub"]

    admin_other = context.request_as(
        context.admin,
        "GET",
        f"/v1/site-configs/{context.other_site_config_id}",
    )
    assert admin_other.status_code == 200
    assert admin_other.json()["owner_user_id"] == context.admin["sub"]

    guest_resp = context.request_as(
        context.guest,
        "GET",
        f"/v1/site-configs/{context.owner_site_config_id}",
    )
    assert guest_resp.status_code == 404


def test_credential_access_controls(api_context):
    context = api_context

    owner_cred = context.request_as(
        context.owner,
        "GET",
        f"/v1/credentials/{context.owner_credential_id}",
    )
    assert owner_cred.status_code == 200
    assert owner_cred.json()["owner_user_id"] == context.owner["sub"]

    admin_global = context.request_as(
        context.admin,
        "GET",
        f"/v1/credentials/{context.global_credential_id}",
    )
    assert admin_global.status_code == 200
    assert admin_global.json()["owner_user_id"] is None

    guest_list = context.request_as(
        context.guest,
        "GET",
        "/v1/credentials",
        params={"include_global": "true"},
    )
    if context.enforce:
        assert guest_list.status_code == 403
    else:
        assert guest_list.status_code == 200
        payload = guest_list.json()
        assert payload["items"] == []
        assert payload["total"] == 0


def test_feed_creation_enforcement(api_context):
    context = api_context

    owner_payload = {
        "url": f"https://example.com/feeds/{'enf' if context.enforce else 'noenf'}-owner-create.xml",
        "poll_frequency": "1h",
        "owner_user_id": context.owner["sub"],
    }
    owner_resp = context.request_as(
        context.owner, "POST", "/v1/feeds/", json=owner_payload
    )
    assert owner_resp.status_code == 201
    assert owner_resp.json()["owner_user_id"] == context.owner["sub"]

    admin_payload = {
        "url": f"https://example.com/feeds/{'enf' if context.enforce else 'noenf'}-admin-create.xml",
        "poll_frequency": "1h",
        "owner_user_id": context.owner["sub"],
    }
    admin_resp = context.request_as(
        context.admin, "POST", "/v1/feeds/", json=admin_payload
    )
    assert admin_resp.status_code == 201
    assert admin_resp.json()["owner_user_id"] == context.owner["sub"]

    guest_payload = {
        "url": f"https://example.com/feeds/{'enf' if context.enforce else 'noenf'}-guest-attempt.xml",
        "poll_frequency": "1h",
        "owner_user_id": context.owner["sub"],
    }
    guest_resp = context.request_as(
        context.guest, "POST", "/v1/feeds/", json=guest_payload
    )
    if context.enforce:
        assert guest_resp.status_code == 403
    else:
        assert guest_resp.status_code == 201
        assert guest_resp.json()["owner_user_id"] == context.guest["sub"]


def test_bookmark_tag_update_enforcement(api_context):
    context = api_context

    owner_update = context.request_as(
        context.owner,
        "PUT",
        f"/v1/bookmarks/tags/{context.owner_tag_id}",
        json={"name": "Owner Updated Tag"},
    )
    assert owner_update.status_code == 200
    assert owner_update.json()["name"] == "Owner Updated Tag"

    admin_update = context.request_as(
        context.admin,
        "PUT",
        f"/v1/bookmarks/tags/{context.owner_tag_id}",
        json={"name": "Admin Updated Tag"},
    )
    if context.enforce:
        assert admin_update.status_code == 200
        assert admin_update.json()["name"] == "Admin Updated Tag"
    else:
        assert admin_update.status_code == 404

    guest_update = context.request_as(
        context.guest,
        "PUT",
        f"/v1/bookmarks/tags/{context.owner_tag_id}",
        json={"name": "Guest Attempt Tag"},
    )
    if context.enforce:
        assert guest_update.status_code == 403
    else:
        assert guest_update.status_code == 404


def _create_site_config_for_user(user_id: str) -> str:
    from app.db import get_session
    from app.models import SiteConfig, SiteLoginType

    with next(get_session()) as session:
        config = SiteConfig(
            name=f"{user_id}-config",
            site_url=f"https://{user_id}.example.com/login",
            login_type=SiteLoginType.SELENIUM,
            selenium_config={
                "username_selector": "#username",
                "password_selector": "#password",
                "login_button_selector": "#login",
            },
            success_text_class="alert alert-user",
            expected_success_text="User success",
            required_cookies=["session"],
            owner_user_id=user_id,
        )
        session.add(config)
        session.commit()
        session.refresh(config)
        return config.id


def _create_feed_with_owner_site_config(context: SimpleNamespace):
    create_resp = context.request_as(
        context.owner,
        "POST",
        "/v1/feeds/",
        json={
            "url": "https://example.com/feeds/owned.xml",
            "site_config_id": context.owner_site_config_id,
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    return create_resp.json()


def _build_feed_update_payload(
    feed: dict,
    *,
    site_config_id: str,
    credential_id: Optional[str] = None,
) -> dict:
    payload = {
        "id": feed["id"],
        "url": str(feed["url"]),
        "poll_frequency": feed.get("poll_frequency") or "1h",
        "initial_lookback_period": feed.get("initial_lookback_period"),
        "is_paywalled": feed.get("is_paywalled", False),
        "rss_requires_auth": feed.get("rss_requires_auth", False),
        "site_config_id": site_config_id,
    }
    if credential_id:
        payload["site_login_credential_id"] = credential_id
    return payload


def test_feed_creation_rejects_foreign_site_config(api_context):
    context = api_context

    other_config_id = _create_site_config_for_user(context.admin["sub"])

    create_resp = context.request_as(
        context.owner,
        "POST",
        "/v1/feeds/",
        json={
            "url": "https://example.com/feeds/other-config.xml",
            "site_config_id": other_config_id,
        },
    )

    assert create_resp.status_code == 422
    assert "site_config_id" in create_resp.text


def test_feed_update_rejects_foreign_site_config(api_context):
    context = api_context

    feed = _create_feed_with_owner_site_config(context)
    other_config_id = _create_site_config_for_user(context.admin["sub"])

    update_payload = _build_feed_update_payload(feed, site_config_id=other_config_id)

    update_resp = context.request_as(
        context.owner,
        "PUT",
        f"/v1/feeds/{feed['id']}",
        json=update_payload,
    )

    assert update_resp.status_code == 422
    assert "site_config_id" in update_resp.text


def test_feed_creation_rejects_global_site_config_without_permission(api_context):
    context = api_context
    if not context.enforce:
        pytest.skip("Permission enforcement disabled")

    create_resp = context.request_as(
        context.owner,
        "POST",
        "/v1/feeds/",
        json={
            "url": "https://example.com/feeds/global-config.xml",
            "site_config_id": context.other_site_config_id,
        },
    )

    assert create_resp.status_code == 422


def test_feed_update_rejects_global_site_config_without_permission(api_context):
    context = api_context
    if not context.enforce:
        pytest.skip("Permission enforcement disabled")

    feed = _create_feed_with_owner_site_config(context)

    update_payload = _build_feed_update_payload(
        feed,
        site_config_id=context.other_site_config_id,
    )

    update_resp = context.request_as(
        context.owner,
        "PUT",
        f"/v1/feeds/{feed['id']}",
        json=update_payload,
    )

    assert update_resp.status_code == 422
