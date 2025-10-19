from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import pytest
import requests
from sqlmodel import select

from app.db import get_session_ctx, init_db
from app.jobs.util_subpaperflux import (
    CookieAuthenticationError,
    format_site_login_pair_id,
    get_cookies_for_site_login_pair,
    perform_login_and_save_cookies,
    poll_rss_and_publish,
)
from app.models import Cookie, Credential, Feed, SiteConfig, SiteLoginType
from app.security.crypto import decrypt_dict, encrypt_dict
from app.services import subpaperflux_login, subpaperflux_rss


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

    future_expiry = (datetime.now(timezone.utc) + timedelta(hours=1)).timestamp()
    dummy_spf = DummySPFModule(
        [
            {"name": "session", "value": "abc", "expiry": future_expiry},
        ]
    )
    monkeypatch.setattr("app.services.subpaperflux_login.login_and_update", dummy_spf.login_and_update)

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
            {"name": "session", "value": "abc", "expiry": future_expiry},
        ]

    stored_cookies = get_cookies_for_site_login_pair(pair_id, "user-1")
    assert stored_cookies == [
        {"name": "session", "value": "abc", "expiry": future_expiry},
    ]

    new_expiry = (datetime.now(timezone.utc) + timedelta(hours=2)).timestamp()
    dummy_spf.cookies = [
        {"name": "session", "value": "xyz", "expiry": new_expiry},
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
        {"name": "session", "value": "xyz", "expiry": new_expiry},
    ]

    helper_cookies = get_cookies_for_site_login_pair(pair_id, "user-1")
    assert helper_cookies == updated_cookies


def test_perform_login_and_save_cookies_rejects_blank_values(monkeypatch, tmp_path):
    _setup_env(monkeypatch, tmp_path)

    blank_cookie_spf = DummySPFModule(
        [
            {"name": "session", "value": ""},
        ]
    )
    monkeypatch.setattr(
        "app.services.subpaperflux_login.login_and_update",
        blank_cookie_spf.login_and_update,
    )

    with get_session_ctx() as session:
        credential = Credential(
            id="cred_blank",
            kind="site_login",
            description="Test credential",
            data={"username": "alice", "password": "wonder"},
            owner_user_id="user-1",
            site_config_id="sc_blank",
        )
        site_config = SiteConfig(
            id="sc_blank",
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

    pair_id = format_site_login_pair_id("cred_blank", "sc_blank")

    with pytest.raises(RuntimeError) as exc:
        perform_login_and_save_cookies(
            site_login_pair_id=pair_id,
            owner_user_id="user-1",
        )

    assert "missing cookie values" in str(exc.value)


def test_apply_cookies_clones_domain_for_subdomain_requests():
    session = requests.Session()
    cookies = [
        {"name": "sessionid", "value": "abc123", "domain": "substack.com"},
    ]

    subpaperflux_rss._apply_cookies_to_session(
        session,
        cookies,
        hostname="newsletter.substack.com",
    )

    prepared = session.prepare_request(
        requests.Request(
            "GET",
            "https://newsletter.substack.com/api/content",
        )
    )

    cookie_header = prepared.headers.get("Cookie")
    assert cookie_header is not None
    assert "sessionid=abc123" in cookie_header


def test_retrieved_cookies_preserve_values_in_request_header(monkeypatch, tmp_path):
    _setup_env(monkeypatch, tmp_path)

    future_expiry = (datetime.now(timezone.utc) + timedelta(hours=1)).timestamp()

    with get_session_ctx() as session:
        credential = Credential(
            id="cred_header",
            kind="site_login",
            description="Header credential",
            data={"username": "user", "password": "pass"},
            owner_user_id="user-1",
            site_config_id="sc_header",
        )
        site_config = SiteConfig(
            id="sc_header",
            name="Header Site",
            site_url="https://member.democracydocket.com",
            login_type=SiteLoginType.SELENIUM,
            selenium_config={"cookies_to_store": ["__hsmem"]},
            required_cookies=["__hsmem"],
            owner_user_id="user-1",
        )
        encrypted = encrypt_dict(
            {
                "cookies": [
                    {
                        "name": "__hsmem",
                        "value": "abc123",
                        "domain": ".member.democracydocket.com",
                        "path": "/",
                        "expiry": future_expiry,
                    }
                ]
            }
        )
        cookie_record = Cookie(
            credential_id="cred_header",
            site_config_id="sc_header",
            owner_user_id="user-1",
            encrypted_cookies=json.dumps(encrypted),
            last_refresh=datetime.now(timezone.utc).isoformat(),
            expiry_hint=future_expiry,
        )
        session.add(credential)
        session.add(site_config)
        session.add(cookie_record)
        session.commit()

    pair_id = format_site_login_pair_id("cred_header", "sc_header")

    cookies = get_cookies_for_site_login_pair(pair_id, "user-1")
    assert cookies == [
        {
            "name": "__hsmem",
            "value": "abc123",
            "domain": ".member.democracydocket.com",
            "path": "/",
            "expiry": future_expiry,
        }
    ]

    import requests

    session = requests.Session()
    try:
        subpaperflux_rss._apply_cookies_to_session(session, cookies)
        # The session should rely on `requests`' cookie jar to set headers on
        # a per-request basis, so the default session headers must remain
        # untouched here. This ensures domain/path scoping remains intact.
        assert "Cookie" not in session.headers
        prepared = session.prepare_request(
            requests.Request(
                "GET",
                "https://member.democracydocket.com/trumps-illinois-invasion-",
            )
        )
        cookie_header = prepared.headers.get("Cookie")
    finally:
        session.close()

    assert cookie_header is not None
    assert "__hsmem=abc123" in cookie_header.split("; ")


def test_perform_login_and_save_cookies_api(monkeypatch, tmp_path):
    _setup_env(monkeypatch, tmp_path)

    class FakeSession:
        def __init__(self):
            self.cookies = requests.cookies.RequestsCookieJar()
            self.headers: dict[str, str] = {}

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
    monkeypatch.setattr(
        "app.services.subpaperflux_login.requests.Session", lambda: FakeSession()
    )

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

    class MissingRefreshSession:
        def __init__(self):
            self.cookies = requests.cookies.RequestsCookieJar()
            self.headers: dict[str, str] = {}

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
    monkeypatch.setattr(
        "app.services.subpaperflux_login.requests.Session",
        lambda: MissingRefreshSession(),
    )

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
    monkeypatch.setattr("app.services.subpaperflux_login.login_and_update", dummy_spf.login_and_update)

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


def test_rss_poll_requires_fresh_cookies(monkeypatch, tmp_path):
    _setup_env(monkeypatch, tmp_path)

    config_dir = tmp_path
    (config_dir / "credentials.json").write_text(json.dumps({}))
    (config_dir / "instapaper_app_creds.json").write_text(json.dumps({}))
    monkeypatch.setenv("SPF_CONFIG_DIR", str(config_dir))

    with get_session_ctx() as session:
        credential = Credential(
            id="cred_expired",
            kind="site_login",
            description="Expired cookie credential",
            data={"username": "alice", "password": "wonder"},
            owner_user_id="user-1",
            site_config_id="sc_expired",
        )
        site_config = SiteConfig(
            id="sc_expired",
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
        feed = Feed(
            owner_user_id="user-1",
            url="https://example.com/rss.xml",
            poll_frequency="1h",
            is_paywalled=True,
            rss_requires_auth=True,
            site_config_id="sc_expired",
            site_login_credential_id="cred_expired",
        )
        session.add(credential)
        session.add(site_config)
        session.add(feed)
        session.commit()
        session.refresh(feed)
        feed_id = feed.id

    pair_id = format_site_login_pair_id("cred_expired", "sc_expired")

    expired_cookie = {
        "name": "session",
        "value": "stale",
        "expiry": (datetime.now(timezone.utc) - timedelta(hours=1)).timestamp(),
    }
    expired_login = DummySPFModule([expired_cookie])
    monkeypatch.setattr("app.services.subpaperflux_login.login_and_update", expired_login.login_and_update)
    perform_login_and_save_cookies(
        site_login_pair_id=pair_id,
        owner_user_id="user-1",
    )

    class TrackingSpf:
        def __init__(self, entries: Optional[list[dict[str, object]]] = None):
            self.entries = entries or []
            self.called = False
            self.login_type = "selenium"

        def login_and_update(self, *args, **kwargs):
            self.called = True
            return {
                "cookies": [dict(entry) for entry in self.entries],
                "login_type": self.login_type,
            }

        def get_new_rss_entries(self, **kwargs):  # type: ignore[override]
            self.called = True
            return [dict(entry) for entry in self.entries]

    tracking_spf = TrackingSpf()
    monkeypatch.setattr("app.services.subpaperflux_login.login_and_update", tracking_spf.login_and_update)
    monkeypatch.setattr(
        "app.services.subpaperflux_rss.get_new_rss_entries",
        tracking_spf.get_new_rss_entries,
    )

    with pytest.raises(CookieAuthenticationError) as exc:
        poll_rss_and_publish(
            feed_id=feed_id,
            owner_user_id="user-1",
            site_login_pair_id=pair_id,
        )

    assert "expired" in str(exc.value)
    assert tracking_spf.called is False

    fresh_cookie = {
        "name": "session",
        "value": "fresh",
        "expiry": (datetime.now(timezone.utc) + timedelta(hours=1)).timestamp(),
    }
    fresh_login = DummySPFModule([fresh_cookie])
    monkeypatch.setattr("app.services.subpaperflux_login.login_and_update", fresh_login.login_and_update)
    perform_login_and_save_cookies(
        site_login_pair_id=pair_id,
        owner_user_id="user-1",
    )

    success_spf = TrackingSpf([])
    monkeypatch.setattr("app.services.subpaperflux_login.login_and_update", success_spf.login_and_update)
    monkeypatch.setattr(
        "app.services.subpaperflux_rss.get_new_rss_entries",
        success_spf.get_new_rss_entries,
    )
    res = poll_rss_and_publish(
        feed_id=feed_id,
        owner_user_id="user-1",
        site_login_pair_id=pair_id,
    )

    assert res == {"stored": 0, "duplicates": 0, "total": 0}
    assert success_spf.called is True
    stored_cookies = get_cookies_for_site_login_pair(pair_id, "user-1")
    assert stored_cookies[0]["value"] == "fresh"


def test_get_cookies_for_site_login_pair_rejects_blank_values(monkeypatch, tmp_path):
    _setup_env(monkeypatch, tmp_path)

    with get_session_ctx() as session:
        credential = Credential(
            id="cred_blank_value",
            kind="site_login",
            description="Blank cookie credential",
            data={"username": "alice", "password": "wonder"},
            owner_user_id="user-1",
            site_config_id="sc_blank_value",
        )
        site_config = SiteConfig(
            id="sc_blank_value",
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
        cookie_payload = encrypt_dict({"cookies": [{"name": "session", "value": ""}]})
        cookie_record = Cookie(
            credential_id="cred_blank_value",
            site_config_id="sc_blank_value",
            owner_user_id="user-1",
            encrypted_cookies=json.dumps(cookie_payload),
        )
        session.add(credential)
        session.add(site_config)
        session.add(cookie_record)
        session.commit()

    pair_id = format_site_login_pair_id("cred_blank_value", "sc_blank_value")

    with pytest.raises(CookieAuthenticationError) as exc:
        get_cookies_for_site_login_pair(pair_id, "user-1")

    message = str(exc.value)
    assert "missing values for configured cookies" in message
    assert "session" in message


def test_poll_rss_invalidates_cookies_on_paywall(monkeypatch, tmp_path):
    _setup_env(monkeypatch, tmp_path)

    config_dir = tmp_path
    (config_dir / "instapaper_app_creds.json").write_text(json.dumps({}))
    (config_dir / "credentials.json").write_text(json.dumps({}))
    monkeypatch.setenv("SPF_CONFIG_DIR", str(config_dir))

    with get_session_ctx() as session:
        site_config = SiteConfig(
            id="sc_paywall",
            name="Paywall Site",
            site_url="https://example.com",
            owner_user_id="user-1",
            selenium_config={"cookies_to_store": ["session"]},
            required_cookies=["session"],
        )
        credential = Credential(
            id="cred_paywall",
            kind="site_login",
            description="Paywall Login",
            data=encrypt_dict(
                {
                    "username": "user",
                    "password": "pass",
                    "site_config_id": site_config.id,
                }
            ),
            owner_user_id="user-1",
            site_config_id=site_config.id,
        )
        feed = Feed(
            owner_user_id="user-1",
            url="https://example.com/rss.xml",
            poll_frequency="1h",
            is_paywalled=True,
            site_config_id=site_config.id,
            site_login_credential_id=credential.id,
        )
        session.add(site_config)
        session.add(credential)
        session.add(feed)
        session.commit()
        session.refresh(feed)

        encrypted = encrypt_dict({"cookies": [{"name": "session", "value": "abc"}]})
        session.add(
            Cookie(
                credential_id=credential.id,
                site_config_id=site_config.id,
                owner_user_id="user-1",
                encrypted_cookies=json.dumps(encrypted),
            )
        )
        session.commit()

    class FakeFeedResponse:
        def __init__(self):
            self.status_code = 200
            self._content = b"<rss></rss>"
            self.text = self._content.decode()

        @property
        def content(self):
            return self._content

        def raise_for_status(self):
            return None

    published = datetime.now(timezone.utc)

    class FakeEntry:
        title = "Paywalled Story"
        link = "https://example.com/articles/paywalled"
        summary = ""
        tags = []
        enclosures = []
        published_parsed = published.timetuple()

    class FakeFeed:
        def __init__(self):
            self.feed = type(
                "FeedMeta",
                (),
                {"title": "Example", "link": "", "language": "en"},
            )()
            self.entries = [FakeEntry()]

    monkeypatch.setattr(
        "app.services.subpaperflux_rss.requests.get",
        lambda *_, **__: FakeFeedResponse(),
    )
    monkeypatch.setattr(
        "app.services.subpaperflux_rss.feedparser.parse", lambda _: FakeFeed()
    )

    fetch_calls = []

    def fake_fetch(url, cookies, header_overrides=None):
        fetch_calls.append((url, cookies))
        raise subpaperflux_rss.PaywalledContentError(url, indicator="simulated")

    monkeypatch.setattr(
        "app.services.subpaperflux_rss.get_article_html_with_cookies", fake_fetch
    )
    pair_id = format_site_login_pair_id("cred_paywall", "sc_paywall")

    res = poll_rss_and_publish(
        feed_id=feed.id,
        owner_user_id="user-1",
        site_login_pair_id=pair_id,
    )

    assert res == {"stored": 0, "duplicates": 0, "total": 0}
    assert fetch_calls, "expected article fetch to be attempted"

    with get_session_ctx() as session:
        stmt = select(Cookie).where(
            (Cookie.credential_id == "cred_paywall")
            & (Cookie.site_config_id == "sc_paywall")
        )
        record = session.exec(stmt).first()
        assert record is None, "cookies should be invalidated after paywall detection"


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
    assert subpaperflux_login._verify_success_text(
        wait,
        "alert alert-success",
        "Signed in",
        "demo_site",
    )
    assert wait.calls == 1


def test_verify_success_text_mismatch(monkeypatch):
    wait = _FakeWait(element=_FakeElement("Something went wrong"))
    assert not subpaperflux_login._verify_success_text(
        wait,
        "alert alert-success",
        "Signed in",
        "demo_site",
    )


def test_verify_success_text_timeout(monkeypatch):
    wait = _FakeWait(exc=subpaperflux_login.TimeoutException("timeout"))
    assert not subpaperflux_login._verify_success_text(
        wait,
        "alert alert-success",
        "Signed in",
        "demo_site",
    )
