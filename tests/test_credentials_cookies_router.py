from __future__ import annotations

import base64
import json
import os
from typing import Dict, List

import pytest
from fastapi.testclient import TestClient

from app.auth.oidc import get_current_user
from app.db import get_session, init_db
from app.main import create_app
from app.models import Cookie, Credential, SiteConfig, SiteLoginType
from app.security.crypto import encrypt_dict


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv(
        "CREDENTIALS_ENC_KEY",
        base64.urlsafe_b64encode(os.urandom(32)).decode(),
    )
    monkeypatch.setenv("USER_MGMT_CORE", "1")
    from app.config import is_user_mgmt_core_enabled

    is_user_mgmt_core_enabled.cache_clear()


def _create_client(identity: Dict[str, object]) -> TestClient:
    init_db()
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: identity
    return TestClient(app)


def _seed_site_login(
    *,
    owner_user_id: str,
    cookies: List[Dict[str, object]] | None = None,
    last_refresh: str = "2024-01-01T00:00:00+00:00",
    expiry_hint: float | None = None,
) -> Credential:
    with next(get_session()) as session:
        site_config = SiteConfig(
            name="Example",
            site_url="https://example.com/login",
            login_type=SiteLoginType.SELENIUM,
            selenium_config={
                "username_selector": "#user",
                "password_selector": "#pass",
                "login_button_selector": "#submit",
                "cookies_to_store": ["session"],
            },
            success_text_class="alert-success",
            expected_success_text="Welcome",
            required_cookies=["session"],
            owner_user_id=owner_user_id,
        )
        session.add(site_config)
        session.commit()
        session.refresh(site_config)

        credential = Credential(
            kind="site_login",
            description="Example credential",
            data=encrypt_dict({"username": "user", "password": "pass"}),
            owner_user_id=owner_user_id,
            site_config_id=site_config.id,
        )
        session.add(credential)
        session.commit()
        session.refresh(credential)

        if cookies is not None:
            cookie_record = Cookie(
                owner_user_id=owner_user_id,
                credential_id=credential.id,
                site_config_id=site_config.id,
                encrypted_cookies=json.dumps(encrypt_dict({"cookies": cookies})),
                last_refresh=last_refresh,
                expiry_hint=expiry_hint,
            )
            session.add(cookie_record)
            session.commit()

        return credential


def test_get_cookies_for_owned_site_login():
    identity = {"sub": "user-1", "groups": []}
    client = _create_client(identity)
    credential = _seed_site_login(
        owner_user_id="user-1",
        cookies=[{"name": "session", "value": "abc123", "expiry": 123.0}],
        expiry_hint=123.0,
    )

    response = client.get(f"/v1/credentials/{credential.id}/cookies")
    assert response.status_code == 200
    payload = response.json()
    assert payload["last_refresh"] == "2024-01-01T00:00:00+00:00"
    assert payload["expiry_hint"] == 123.0
    cookies = payload["cookies"]
    assert len(cookies) == 1
    cookie = cookies[0]
    assert cookie["name"] == "session"
    assert cookie["value"] == "abc123"
    assert cookie["expiry"] == 123.0


def test_get_cookies_requires_ownership():
    credential = _seed_site_login(
        owner_user_id="user-1",
        cookies=[{"name": "session", "value": "abc123"}],
    )
    identity = {"sub": "user-2", "groups": []}
    client = _create_client(identity)

    response = client.get(f"/v1/credentials/{credential.id}/cookies")
    assert response.status_code == 404


def test_get_cookies_missing_record_returns_404():
    identity = {"sub": "user-1", "groups": []}
    client = _create_client(identity)
    credential = _seed_site_login(owner_user_id="user-1", cookies=None)

    response = client.get(f"/v1/credentials/{credential.id}/cookies")
    assert response.status_code == 404
