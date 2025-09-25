from __future__ import annotations

import base64
import json
import os
from pathlib import Path

from sqlmodel import select

from app.db import get_session_ctx, init_db
from app.jobs.util_subpaperflux import (
    format_site_login_pair_id,
    get_cookies_for_site_login_pair,
    perform_login_and_save_cookies,
)
from app.models import Cookie, Credential, SiteConfig
from app.security.crypto import decrypt_dict


class DummySPFModule:
    def __init__(self, cookies: list[dict[str, object]]):
        self.cookies = cookies

    def login_and_update(self, site_config_id, site_config, login_credentials):
        return [dict(cookie) for cookie in self.cookies]


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

    dummy_spf = DummySPFModule([
        {"name": "session", "value": "abc", "expiry": 123.0},
    ])
    monkeypatch.setattr(
        "app.jobs.util_subpaperflux._import_spf", lambda: dummy_spf
    )

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
            username_selector="#user",
            password_selector="#pass",
            login_button_selector="#submit",
            cookies_to_store=["session"],
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
        decrypted = decrypt_dict(json.loads(cookie.encrypted_cookies)) if cookie.encrypted_cookies else {}
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
