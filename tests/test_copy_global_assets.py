import base64
import os
from pathlib import Path
from typing import Optional, Tuple

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


def _insert_global_credential(*, description: str = "Global Instapaper App") -> Tuple[str, dict]:
    from app.db import get_session
    from app.models import Credential
    from app.security.crypto import encrypt_dict

    plain = {
        "consumer_key": "global-key",
        "consumer_secret": "global-secret",
    }

    with next(get_session()) as session:
        record = Credential(
            kind="instapaper_app",
            description=description,
            data=encrypt_dict(plain),
            owner_user_id=None,
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record.id, plain


def _create_user_credential(*, description: str = "User credential"):
    from app.db import get_session
    from app.models import Credential
    from app.security.crypto import encrypt_dict

    plain = {
        "oauth_token": "user-token",
        "oauth_token_secret": "user-secret",
    }

    with next(get_session()) as session:
        record = Credential(
            kind="instapaper",
            description=description,
            data=encrypt_dict(plain),
            owner_user_id=USER_ID,
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record


def test_copy_global_credential_creates_user_owned_clone(copy_client):
    global_credential_id, plain = _insert_global_credential()

    response = copy_client.post(f"/v1/credentials/{global_credential_id}/copy")
    assert response.status_code == 201

    payload = response.json()
    assert payload["id"] != global_credential_id
    assert payload["owner_user_id"] == USER_ID
    assert payload["kind"] == "instapaper_app"
    assert payload["description"] == "Global Instapaper App"

    from app.db import get_session
    from app.models import AuditLog, Credential
    from app.security.crypto import decrypt_dict

    with next(get_session()) as session:
        clone = session.get(Credential, payload["id"])
        assert clone is not None
        assert clone.owner_user_id == USER_ID
        assert clone.kind == "instapaper_app"
        assert decrypt_dict(clone.data) == plain

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
        assert audit.details["source_credential_id"] == global_credential_id
        assert audit.details["kind"] == "instapaper_app"
        assert audit.details["description"] == "Global Instapaper App"


def test_copy_global_credentials_respects_quota_limits(copy_client):
    _seed_user(quota_credentials=1)
    global_credential_id, _ = _insert_global_credential()
    _create_user_credential(description="Existing credential")

    cred_response = copy_client.post(f"/v1/credentials/{global_credential_id}/copy")
    assert cred_response.status_code == 403
    cred_payload = cred_response.json()
    assert "quota exceeded" in cred_payload.get("message", "").lower()

    from app.db import get_session
    from app.models import AuditLog, Credential

    with next(get_session()) as session:
        creds = session.exec(select(Credential)).all()
        owned_creds = [c for c in creds if c.owner_user_id == USER_ID]
        assert len(owned_creds) == 1

        audit_entries = session.exec(
            select(AuditLog).where(AuditLog.action == "copy")
        ).all()
        assert audit_entries == []
