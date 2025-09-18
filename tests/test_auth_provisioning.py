from __future__ import annotations

from pathlib import Path
from typing import Dict

import pytest


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.setenv("USER_MGMT_CORE", "1")
    from app.config import is_user_mgmt_core_enabled

    is_user_mgmt_core_enabled.cache_clear()
    try:
        yield
    finally:
        is_user_mgmt_core_enabled.cache_clear()


def _make_identity() -> Dict[str, object]:
    return {
        "sub": "provisioned-user",
        "email": "provisioned@example.com",
        "name": "Provisioned User",
        "picture": "https://example.com/avatar.png",
        "claims": {"groups": ["member"]},
    }


def test_maybe_provision_user_creates_user_and_assigns_default_role(monkeypatch):
    from app.auth import ensure_role, get_user_roles
    from app.auth.provisioning import maybe_provision_user
    from app.db import get_session, init_db
    from app.models import User

    init_db()
    monkeypatch.setenv("OIDC_AUTO_PROVISION_USERS", "1")
    monkeypatch.setenv("OIDC_AUTO_PROVISION_DEFAULT_ROLE", "member")

    with next(get_session()) as session:
        ensure_role(session, "member", description="Default member role")
        session.commit()

    identity = _make_identity()

    maybe_provision_user(identity)

    with next(get_session()) as session:
        user = session.get(User, identity["sub"])
        assert user is not None
        assert user.email == identity["email"]
        assert user.full_name == identity["name"]
        assert "member" in get_user_roles(session, user.id)


def test_maybe_provision_user_skips_when_disabled(monkeypatch):
    from app.auth.provisioning import maybe_provision_user
    from app.db import get_session, init_db
    from app.models import User

    init_db()
    monkeypatch.setenv("OIDC_AUTO_PROVISION_USERS", "0")
    monkeypatch.delenv("OIDC_AUTO_PROVISION_DEFAULT_ROLE", raising=False)

    identity = _make_identity()

    maybe_provision_user(identity)

    with next(get_session()) as session:
        assert session.get(User, identity["sub"]) is None
