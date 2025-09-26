import base64
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.setenv("USER_MGMT_ENFORCE", "0")
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    monkeypatch.setenv(
        "CREDENTIALS_ENC_KEY",
        base64.urlsafe_b64encode(os.urandom(32)).decode(),
    )

    from app.config import is_user_mgmt_enforce_enabled

    is_user_mgmt_enforce_enabled.cache_clear()
    try:
        yield
    finally:
        is_user_mgmt_enforce_enabled.cache_clear()


@pytest.fixture()
def quota_client():
    from app.auth.oidc import get_current_user
    from app.db import init_db
    from app.main import create_app

    init_db()
    app = create_app()
    identity = {
        "sub": "quota-user",
        "email": "quota@example.com",
        "name": "Quota User",
        "groups": [],
    }
    app.dependency_overrides[get_current_user] = lambda: identity
    client = TestClient(app)
    try:
        yield client
    finally:
        app.dependency_overrides.clear()


def _seed_user(
    *,
    quota_credentials=None,
    quota_site_configs=None,
    quota_feeds=None,
    quota_api_tokens=None,
):
    from app.db import get_session
    from app.models import User

    with next(get_session()) as session:
        user = User(
            id="quota-user",
            email="quota@example.com",
            quota_credentials=quota_credentials,
            quota_site_configs=quota_site_configs,
            quota_feeds=quota_feeds,
            quota_api_tokens=quota_api_tokens,
        )
        session.add(user)
        session.commit()


def test_credential_quota_enforced(quota_client):
    _seed_user(quota_credentials=1)

    resp_ok = quota_client.post(
        "/credentials",
        json={
            "kind": "instapaper",
            "description": "First credential",
            "data": {"oauth_token": "one"},
        },
    )
    assert resp_ok.status_code == 201

    resp_blocked = quota_client.post(
        "/credentials",
        json={
            "kind": "instapaper",
            "description": "Second credential",
            "data": {"oauth_token": "two"},
        },
    )
    assert resp_blocked.status_code == 403
    assert resp_blocked.status_code == 403


def test_site_config_quota_enforced(quota_client):
    _seed_user(quota_site_configs=1)

    payload = {
        "name": "Example",
        "site_url": "https://example.com",
        "login_type": "selenium",
        "selenium_config": {
            "username_selector": "#user",
            "password_selector": "#pass",
            "login_button_selector": "#submit",
            "post_login_selector": None,
            "cookies_to_store": [],
        },
        "owner_user_id": "quota-user",
    }

    resp_ok = quota_client.post("/site-configs", json=payload)
    assert resp_ok.status_code == 201

    resp_blocked = quota_client.post("/site-configs", json=payload)
    assert resp_blocked.status_code == 403


def test_feed_quota_enforced(quota_client):
    _seed_user(quota_feeds=1)

    resp_ok = quota_client.post(
        "/feeds/",
        json={"url": "https://example.com/feed", "poll_frequency": "1h"},
    )
    assert resp_ok.status_code == 201

    resp_blocked = quota_client.post(
        "/feeds/",
        json={"url": "https://example.org/feed", "poll_frequency": "1h"},
    )
    assert resp_blocked.status_code == 403


def test_api_token_quota_enforced(quota_client):
    _seed_user(quota_api_tokens=1)

    resp_ok = quota_client.post(
        "/v1/me/tokens",
        json={"name": "primary"},
    )
    assert resp_ok.status_code == 201

    resp_blocked = quota_client.post(
        "/v1/me/tokens",
        json={"name": "secondary"},
    )
    assert resp_blocked.status_code == 403
