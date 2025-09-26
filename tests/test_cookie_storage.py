from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Optional

import pytest
import requests
import subpaperflux
from sqlmodel import select

from app.db import get_session_ctx, init_db
from app.jobs.util_subpaperflux import (
    format_site_login_pair_id,
    get_cookies_for_site_login_pair,
    perform_login_and_save_cookies,
)
from app.models import Cookie, Credential, SiteConfig, SiteLoginType
from app.security.crypto import decrypt_dict


class DummySPFModule:
    def __init__(self, cookies: list[dict[str, object]], login_type: str = "selenium"):
        self.cookies = cookies
        self.login_type = login_type
        self.error: str | None = None

    def login_and_update(self, site_config_id, site_config, login_credentials):
        if self.error:
            return {"cookies": [], "login_type": self.login_type, "error": self.error}
        return {
            "cookies": [dict(cookie) for cookie in self.cookies],
            "login_type": self.login_type,
        }


def _setup_env(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv(
        "CREDENTIALS_ENC_KEY",
        base64.urlsafe_b64encode(os.urandom(32)).decode(),
    )
    init_db()
    # Ensure config directory exists for JSON lookups
    tmp_path.mkdir(parents=True, exist_ok=True)


def test_cookie_records_include_credential_reference(monkeypatch, tmp_path):
    _setup_env(monkeypatch, tmp_path)

    dummy_spf = DummySPFModule(
        [
            {"name": "session", "value": "abc", "expiry": 123.0},
        ]
    )
    monkeypatch.setattr("app.jobs.util_subpaperflux._import_spf", lambda: dummy_spf)

    with get_session_ctx() as session:
        credential = Credential(
            id="cred_test",
            kind="site_login",
            description="Test credential",
            data={"username": "alice", "password": "wonder"},
            owner_user_id="user-1",
            site_config_id="sc_test",
        )
        site_config = SiteConfig(
            id="sc_test",
            name="Example",
            site_url="https://example.com",
            login_type=SiteLoginType.SELENIUM,
            selenium_config={
                "username_selector": "#user",
                "password_selector": "#pass",
                "login_button_selector": "#submit",
                "cookies_to_store": ["session"],
            },
            success_text_class="alert alert-success",
            expected_success_text="Signed in",
            required_cookies=["session"],
            owner_user_id="user-1",
        )
        session.add(credential)
        session.add(site_config)
        session.commit()

    pair_id = format_site_login_pair_id("cred_test", "sc_test")
    result = perform_login_and_save_cookies(
        site_login_pair_id=pair_id,
        owner_user_id="user-1",
    )
    assert result["site_login_pair"] == pair_id
    assert result["login_type"] == "selenium"
    assert result["cookies_saved"] == 1

    with get_session_ctx() as session:
        cookie = session.exec(
            select(Cookie).where(
                Cookie.site_config_id == "sc_test",
                Cookie.credential_id == "cred_test",
            )
        ).one()
        assert cookie.credential_id == "cred_test"
        assert cookie.site_config_id == "sc_test"
        assert isinstance(cookie.encrypted_cookies, str)
        decrypted = (
            decrypt_dict(json.loads(cookie.encrypted_cookies))
            if cookie.encrypted_cookies
            else {}
        )
        assert decrypted.get("cookies") == [
            {"name": "session", "value": "abc", "expiry": 123.0},
        ]

    stored_cookies = get_cookies_for_site_login_pair(pair_id, "user-1")
    assert stored_cookies == [
        {"name": "session", "value": "abc", "expiry": 123.0},
    ]

    dummy_spf.cookies = [
        {"name": "session", "value": "xyz", "expiry": 456.0},
    ]
    perform_login_and_save_cookies(
        site_login_pair_id=pair_id,
        owner_user_id="user-1",
    )

    with get_session_ctx() as session:
        cookies = session.exec(select(Cookie)).all()
        assert len(cookies) == 1
        assert cookies[0].credential_id == "cred_test"

    updated_cookies = get_cookies_for_site_login_pair(pair_id, "user-1")
    assert updated_cookies == [
        {"name": "session", "value": "xyz", "expiry": 456.0},
    ]

    helper_cookies = get_cookies_for_site_login_pair(pair_id, "user-1")
    assert helper_cookies == updated_cookies


def test_perform_login_and_save_cookies_api(monkeypatch, tmp_path):
    _setup_env(monkeypatch, tmp_path)

    monkeypatch.setattr("app.jobs.util_subpaperflux._import_spf", lambda: subpaperflux)

    class FakeSession:
        def __init__(self):
            self.cookies = requests.cookies.RequestsCookieJar()

        def request(self, method, url, headers=None, params=None, json=None):
            self.cookies.set("session_token", "abc123", domain="api.example.com", path="/")
            response = requests.Response()
            response.status_code = 200
            response._content = jsonlib.dumps(
                {"data": {"tokens": {"refresh": "refresh123"}}}
            ).encode()
            response.url = url
            return response

        def close(self):
            pass

    jsonlib = json
    monkeypatch.setattr("subpaperflux.requests.Session", lambda: FakeSession())

    with get_session_ctx() as session:
        credential = Credential(
            id="cred_api",
            kind="site_login",
            description="API Credential",
            data={"username": "bob", "password": "builder"},
            owner_user_id="user-1",
            site_config_id="sc_api",
        )
        site_config = SiteConfig(
            id="sc_api",
            name="API Example",
            site_url="https://api.example.com",
            login_type=SiteLoginType.API,
            api_config={
                "endpoint": "https://api.example.com/login",
                "method": "POST",
                "headers": {"Content-Type": "application/json"},
                "cookies_to_store": ["session_token"],
                "cookies": {"refresh_token": "$.data.tokens.refresh"},
            },
            success_text_class="toast toast-success",
            expected_success_text="API signed in",
            required_cookies=["session_token", "refresh_token"],
            owner_user_id="user-1",
        )
        session.add(credential)
        session.add(site_config)
        session.commit()

    pair_id = format_site_login_pair_id("cred_api", "sc_api")
    result = perform_login_and_save_cookies(
        site_login_pair_id=pair_id,
        owner_user_id="user-1",
    )

    assert result["login_type"] == "api"
    assert result["cookies_saved"] == 1

    stored_cookies = get_cookies_for_site_login_pair(pair_id, "user-1")
    assert {cookie["name"] for cookie in stored_cookies} == {"session_token"}
    session_cookie = stored_cookies[0]
    assert session_cookie["value"] == "abc123"
    assert session_cookie.get("domain") == "api.example.com"
    assert session_cookie.get("path") == "/"

    # The refresh token is required for success but not persisted because it is not in cookies_to_store
    assert all(cookie["name"] != "refresh_token" for cookie in stored_cookies)


def test_perform_login_and_save_cookies_missing_required_cookie(monkeypatch, tmp_path):
    _setup_env(monkeypatch, tmp_path)

    monkeypatch.setattr("app.jobs.util_subpaperflux._import_spf", lambda: subpaperflux)

    class MissingRefreshSession:
        def __init__(self):
            self.cookies = requests.cookies.RequestsCookieJar()

        def request(self, method, url, headers=None, params=None, json=None):
            self.cookies.set("session_token", "abc123", domain="api.example.com", path="/")
            response = requests.Response()
            response.status_code = 200
            response._content = jsonlib.dumps({"data": {}}).encode()
            response.url = url
            return response

        def close(self):
            pass

    jsonlib = json
    monkeypatch.setattr("subpaperflux.requests.Session", lambda: MissingRefreshSession())

    with get_session_ctx() as session:
        credential = Credential(
            id="cred_api_missing",
            kind="site_login",
            description="API Credential Missing Required",
            data={"username": "bob", "password": "builder"},
            owner_user_id="user-1",
            site_config_id="sc_api_missing",
        )
        site_config = SiteConfig(
            id="sc_api_missing",
            name="API Example Missing",
            site_url="https://api.example.com",
            login_type=SiteLoginType.API,
            api_config={
                "endpoint": "https://api.example.com/login",
                "method": "POST",
                "headers": {"Content-Type": "application/json"},
                "cookies_to_store": ["session_token"],
                "cookies": {"refresh_token": "$.data.tokens.refresh"},
            },
            success_text_class="toast toast-success",
            expected_success_text="API signed in",
            required_cookies=["session_token", "refresh_token"],
            owner_user_id="user-1",
        )
        session.add(credential)
        session.add(site_config)
        session.commit()

    pair_id = format_site_login_pair_id("cred_api_missing", "sc_api_missing")

    with pytest.raises(RuntimeError) as exc:
        perform_login_and_save_cookies(
            site_login_pair_id=pair_id,
            owner_user_id="user-1",
        )

    assert "Missing required cookies after API login" in str(exc.value)


def test_perform_login_and_save_cookies_surface_error(monkeypatch, tmp_path):
    _setup_env(monkeypatch, tmp_path)

    dummy_spf = DummySPFModule(
        [
            {"name": "session", "value": "abc", "expiry": 123.0},
        ]
    )
    dummy_spf.error = "boom"
    monkeypatch.setattr("app.jobs.util_subpaperflux._import_spf", lambda: dummy_spf)

    with get_session_ctx() as session:
        credential = Credential(
            id="cred_error",
            kind="site_login",
            description="Test credential",
            data={"username": "alice", "password": "wonder"},
            owner_user_id="user-1",
            site_config_id="sc_error",
        )
        site_config = SiteConfig(
            id="sc_error",
            name="Example",
            site_url="https://example.com",
            login_type=SiteLoginType.SELENIUM,
            selenium_config={
                "username_selector": "#user",
                "password_selector": "#pass",
                "login_button_selector": "#submit",
                "cookies_to_store": ["session"],
            },
            success_text_class="alert alert-danger",
            expected_success_text="Error state",
            required_cookies=["session"],
            owner_user_id="user-1",
        )
        session.add(credential)
        session.add(site_config)
        session.commit()

    pair_id = format_site_login_pair_id("cred_error", "sc_error")
    with pytest.raises(RuntimeError) as exc:
        perform_login_and_save_cookies(
            site_login_pair_id=pair_id,
            owner_user_id="user-1",
        )

    assert "boom" in str(exc.value)


class _FakeElement:
    def __init__(self, text: str):
        self.text = text


class _FakeWait:
    def __init__(self, element=None, exc: Optional[Exception] = None):
        self.element = element
        self.exc = exc
        self.calls = 0

    def until(self, condition):  # pragma: no cover - condition unused in tests
        self.calls += 1
        if self.exc:
            raise self.exc
        return self.element


def test_verify_success_text_success(monkeypatch):
    wait = _FakeWait(element=_FakeElement("Signed in successfully"))
    assert subpaperflux._verify_success_text(
        wait,
        "alert alert-success",
        "Signed in",
        "demo_site",
    )
    assert wait.calls == 1


def test_verify_success_text_mismatch(monkeypatch):
    wait = _FakeWait(element=_FakeElement("Something went wrong"))
    assert not subpaperflux._verify_success_text(
        wait,
        "alert alert-success",
        "Signed in",
        "demo_site",
    )


def test_verify_success_text_timeout(monkeypatch):
    wait = _FakeWait(exc=subpaperflux.TimeoutException("timeout"))
    assert not subpaperflux._verify_success_text(
        wait,
        "alert alert-success",
        "Signed in",
        "demo_site",
    )
