import base64
import os
from pathlib import Path
from typing import Optional

import pytest
from fastapi.testclient import TestClient
from sqlmodel import select


USER_ID = "copy-user"
IDENTITY = {
    "sub": USER_ID,
    "email": "copy@example.com",
    "name": "Copy User",
    "groups": ["admin"],
}

_UNSET = object()


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.setenv("USER_MGMT_CORE", "1")
    monkeypatch.setenv(
        "CREDENTIALS_ENC_KEY",
        base64.urlsafe_b64encode(os.urandom(32)).decode(),
    )

    from app.config import is_user_mgmt_core_enabled, is_user_mgmt_enforce_enabled

    is_user_mgmt_core_enabled.cache_clear()
    is_user_mgmt_enforce_enabled.cache_clear()


@pytest.fixture()
def copy_client():
    from app.auth.oidc import get_current_user
    from app.db import init_db
    from app.main import create_app

    init_db()
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: IDENTITY
    client = TestClient(app)

    _seed_user()

    try:
        yield client
    finally:
        app.dependency_overrides.clear()


def _seed_user(*, quota_credentials=_UNSET, quota_site_configs=_UNSET):
    from app.auth import ADMIN_ROLE_NAME, ensure_admin_role, grant_role
    from app.db import get_session
    from app.models import User

    with next(get_session()) as session:
        ensure_admin_role(session)
        session.commit()

        user = session.get(User, USER_ID)
        if user is None:
            user = User(
                id=USER_ID,
                email=IDENTITY.get("email"),
                full_name=IDENTITY.get("name"),
                claims={"groups": IDENTITY.get("groups", [])},
            )
        else:
            user.email = IDENTITY.get("email")
            user.full_name = IDENTITY.get("name")
            user.claims = {"groups": IDENTITY.get("groups", [])}

        if quota_credentials is not _UNSET:
            user.quota_credentials = quota_credentials
        if quota_site_configs is not _UNSET:
            user.quota_site_configs = quota_site_configs

        session.add(user)
        session.commit()

        grant_role(
            session,
            user.id,
            ADMIN_ROLE_NAME,
            granted_by_user_id=user.id,
        )
        session.commit()


def _insert_global_credential(*, site_config_id: Optional[str] = None):
    from app.db import get_session
    from app.models import Credential
    from app.security.crypto import encrypt_dict
    from app.models import SiteConfig, SiteLoginType

    plain = {
        "username": "global-user",
        "password": "global-pass",
        "note": "shared",
    }

    with next(get_session()) as session:
        target_site_config_id = site_config_id
        if target_site_config_id is None:
            site_config = session.exec(
                select(SiteConfig).where(SiteConfig.owner_user_id.is_(None))
            ).first()
            if site_config is None:
                site_config = SiteConfig(
                    name="Global Login",
                    site_url="https://global.example.com/login",
                    login_type=SiteLoginType.SELENIUM,
                    selenium_config={
                        "username_selector": "#global-user",
                        "password_selector": "#global-pass",
                        "login_button_selector": "#login",
                        "post_login_selector": ".dashboard",
                        "cookies_to_store": ["sid", "csrftoken"],
                    },
                    owner_user_id=None,
                )
                session.add(site_config)
                session.commit()
                session.refresh(site_config)
            target_site_config_id = site_config.id

        record = Credential(
            kind="site_login",
            description="Global credential",
            data=encrypt_dict(plain),
            owner_user_id=None,
            site_config_id=target_site_config_id,
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record, plain


def _insert_global_site_config():
    from app.db import get_session
    from app.models import SiteConfig, SiteLoginType

    with next(get_session()) as session:
        record = SiteConfig(
            name="Global Login",
            site_url="https://global.example.com/login",
            login_type=SiteLoginType.SELENIUM,
            selenium_config={
                "username_selector": "#global-user",
                "password_selector": "#global-pass",
                "login_button_selector": "#login",  # pragma: allowlist secret
                "post_login_selector": ".dashboard",
                "cookies_to_store": ["sid", "csrftoken"],
            },
            owner_user_id=None,
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record


def _create_user_credential(
    *, description="User credential", site_config_id: Optional[str] = None
):
    from app.db import get_session
    from app.models import Credential
    from app.security.crypto import encrypt_dict
    from app.models import SiteConfig, SiteLoginType

    with next(get_session()) as session:
        target_site_config_id = site_config_id
        if target_site_config_id is None:
            site_config = session.exec(
                select(SiteConfig).where(SiteConfig.owner_user_id == USER_ID)
            ).first()
            if site_config is None:
                site_config = SiteConfig(
                    name="User Login",
                    site_url="https://user.example.com/login",
                    login_type=SiteLoginType.SELENIUM,
                    selenium_config={
                        "username_selector": "#user",
                        "password_selector": "#pass",
                        "login_button_selector": "#submit",
                        "post_login_selector": ".app",
                        "cookies_to_store": ["sid"],
                    },
                    owner_user_id=USER_ID,
                )
                session.add(site_config)
                session.commit()
                session.refresh(site_config)
            target_site_config_id = site_config.id

        record = Credential(
            kind="site_login",
            description=description,
            data=encrypt_dict({"username": "user", "password": "secret"}),
            owner_user_id=USER_ID,
            site_config_id=target_site_config_id,
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record


def _create_user_site_config(name="User Login"):
    from app.db import get_session
    from app.models import SiteConfig, SiteLoginType

    with next(get_session()) as session:
        record = SiteConfig(
            name=name,
            site_url="https://user.example.com/login",
            login_type=SiteLoginType.SELENIUM,
            selenium_config={
                "username_selector": "#user",
                "password_selector": "#pass",
                "login_button_selector": "#submit",
                "post_login_selector": ".app",
                "cookies_to_store": ["sid"],
            },
            owner_user_id=USER_ID,
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record


def test_copy_global_site_config_creates_user_owned_clone(copy_client):
    global_config = _insert_global_site_config()

    response = copy_client.post(f"/v1/site-configs/{global_config.id}/copy")
    assert response.status_code == 201

    payload = response.json()
    assert payload["id"] != global_config.id
    assert payload["owner_user_id"] == USER_ID
    assert payload["name"] == global_config.name
    assert payload["site_url"] == global_config.site_url
    assert (
        payload["selenium_config"]["cookies_to_store"] == global_config.cookies_to_store
    )

    from app.db import get_session
    from app.models import AuditLog, SiteConfig

    with next(get_session()) as session:
        clone = session.get(SiteConfig, payload["id"])
        assert clone is not None
        assert clone.owner_user_id == USER_ID
        assert clone.username_selector == global_config.username_selector
        assert clone.password_selector == global_config.password_selector
        assert clone.login_button_selector == global_config.login_button_selector
        assert clone.cookies_to_store == global_config.cookies_to_store

        records = session.exec(select(SiteConfig)).all()
        assert len(records) == 2

        audit = session.exec(
            select(AuditLog)
            .where(AuditLog.entity_type == "setting")
            .where(AuditLog.entity_id == clone.id)
            .where(AuditLog.action == "copy")
        ).one()
        assert audit.owner_user_id == USER_ID
        assert audit.actor_user_id == USER_ID
        assert audit.details["source_config_id"] == global_config.id
        assert audit.details["name"] == global_config.name


def test_copy_global_credential_creates_user_owned_clone(copy_client):
    global_config = _insert_global_site_config()
    global_credential, plain = _insert_global_credential(
        site_config_id=global_config.id
    )

    response = copy_client.post(f"/v1/credentials/{global_credential.id}/copy")
    assert response.status_code == 201

    payload = response.json()
    assert payload["id"] != global_credential.id
    assert payload["owner_user_id"] == USER_ID
    assert payload["kind"] == global_credential.kind
    assert payload["description"] == global_credential.description

    from app.db import get_session
    from app.models import AuditLog, Credential
    from app.security.crypto import decrypt_dict

    with next(get_session()) as session:
        clone = session.get(Credential, payload["id"])
        assert clone is not None
        assert clone.owner_user_id == USER_ID
        assert clone.kind == global_credential.kind
        assert clone.description == global_credential.description

        decrypted = decrypt_dict(clone.data)
        assert decrypted == plain

        records = session.exec(select(Credential)).all()
        assert len(records) == 2

        audit = session.exec(
            select(AuditLog)
            .where(AuditLog.entity_type == "credential")
            .where(AuditLog.entity_id == clone.id)
            .where(AuditLog.action == "copy")
        ).one()
        assert audit.owner_user_id == USER_ID
        assert audit.actor_user_id == USER_ID
        assert audit.details["source_credential_id"] == global_credential.id
        assert audit.details["data_keys"] == sorted(plain.keys())
        assert audit.details["description"] == global_credential.description


def test_copy_global_assets_respects_quota_limits(copy_client):
    _seed_user(quota_credentials=1, quota_site_configs=1)
    global_config = _insert_global_site_config()
    global_credential, _ = _insert_global_credential(site_config_id=global_config.id)

    user_config = _create_user_site_config(name="Existing config")
    _create_user_credential(
        description="Existing credential", site_config_id=user_config.id
    )

    cred_response = copy_client.post(f"/v1/credentials/{global_credential.id}/copy")
    assert cred_response.status_code == 403
    cred_payload = cred_response.json()
    assert "quota exceeded" in cred_payload.get("message", "").lower()

    site_response = copy_client.post(f"/v1/site-configs/{global_config.id}/copy")
    assert site_response.status_code == 403
    site_payload = site_response.json()
    assert "quota exceeded" in site_payload.get("message", "").lower()

    from app.db import get_session
    from app.models import AuditLog, Credential, SiteConfig

    with next(get_session()) as session:
        creds = session.exec(select(Credential)).all()
        owned_creds = [c for c in creds if c.owner_user_id == USER_ID]
        assert len(owned_creds) == 1

        configs = session.exec(select(SiteConfig)).all()
        owned_configs = [c for c in configs if c.owner_user_id == USER_ID]
        assert len(owned_configs) == 1

        audit_entries = session.exec(
            select(AuditLog).where(AuditLog.action == "copy")
        ).all()
        assert audit_entries == []
