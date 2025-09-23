from __future__ import annotations

import base64
import os
from pathlib import Path

from sqlmodel import select

from app.db import get_session_ctx, init_db
from app.jobs.util_subpaperflux import (
    get_cookies_from_db,
    perform_login_and_save_cookies,
)
from app.models import Cookie, Credential, SiteConfig


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

    result = perform_login_and_save_cookies(
        config_dir=str(tmp_path),
        site_config_id="sc_test",
        credential_id="cred_test",
        owner_user_id="user-1",
    )
    assert result["cookie_key"] == "cred_test-sc_test"

    with get_session_ctx() as session:
        cookie = session.exec(
            select(Cookie).where(
                Cookie.site_config_id == "sc_test",
                Cookie.credential_id == "cred_test",
            )
        ).one()
        assert cookie.credential_id == "cred_test"
        assert cookie.site_config_id == "sc_test"
        assert cookie.cookie_key == "cred_test-sc_test"

    stored_cookies = get_cookies_from_db("cred_test-sc_test")
    assert stored_cookies == [
        {"name": "session", "value": "abc", "expiry": 123.0},
    ]

    dummy_spf.cookies = [
        {"name": "session", "value": "xyz", "expiry": 456.0},
    ]
    perform_login_and_save_cookies(
        config_dir=str(tmp_path),
        site_config_id="sc_test",
        credential_id="cred_test",
        owner_user_id="user-1",
    )

    with get_session_ctx() as session:
        cookies = session.exec(select(Cookie)).all()
        assert len(cookies) == 1
        assert cookies[0].credential_id == "cred_test"

    updated_cookies = get_cookies_from_db("cred_test-sc_test")
    assert updated_cookies == [
        {"name": "session", "value": "xyz", "expiry": 456.0},
    ]
