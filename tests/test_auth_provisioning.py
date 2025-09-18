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
    monkeypatch.delenv("OIDC_GROUP_ROLE_MAP", raising=False)
    monkeypatch.delenv("OIDC_GROUP_ROLE_DEFAULTS", raising=False)
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


def test_sync_user_roles_from_identity_assigns_roles(monkeypatch):
    from app.auth import get_user_roles
    from app.auth.provisioning import sync_user_roles_from_identity
    from app.db import get_session, init_db
    from app.models import User

    init_db()
    monkeypatch.setenv("OIDC_GROUP_ROLE_MAP", "staff=staff")
    monkeypatch.setenv("OIDC_GROUP_ROLE_DEFAULTS", "")

    with next(get_session()) as session:
        user = User(id="sync-user")
        session.add(user)
        session.commit()

        user = session.get(User, user.id)
        changed = sync_user_roles_from_identity(session, user, {"groups": ["staff"]})
        assert changed is True
        session.commit()

    with next(get_session()) as session:
        roles = get_user_roles(session, "sync-user")
        assert roles == ["staff"]

    with next(get_session()) as session:
        user = session.get(User, "sync-user")
        changed = sync_user_roles_from_identity(session, user, {"groups": ["staff"]})
        assert changed is False


def test_sync_user_roles_respects_overrides(monkeypatch):
    from app.auth import get_user_roles, grant_role
    from app.auth.provisioning import sync_user_roles_from_identity
    from app.auth.role_overrides import RoleOverrides, set_user_role_overrides
    from app.db import get_session, init_db
    from app.models import User

    init_db()
    monkeypatch.setenv("OIDC_GROUP_ROLE_MAP", "team-auto=auto-role")
    monkeypatch.setenv("OIDC_GROUP_ROLE_DEFAULTS", "")

    with next(get_session()) as session:
        user = User(id="override-user")
        session.add(user)
        session.commit()

        user = session.get(User, user.id)
        grant_role(session, user.id, "auto-role", create_missing=True)
        grant_role(session, user.id, "manual-role", create_missing=True)
        session.commit()

        user = session.get(User, user.id)
        overrides = RoleOverrides.from_iterables(preserve=["manual-role"], suppress=["auto-role"])
        set_user_role_overrides(user, overrides=overrides)
        session.add(user)
        session.commit()

        changed = sync_user_roles_from_identity(session, user, {"groups": ["team-auto"]})
        assert changed is True
        session.commit()

    with next(get_session()) as session:
        roles = set(get_user_roles(session, "override-user"))
        assert roles == {"manual-role"}


def test_sync_user_roles_skips_revokes_when_overrides_enabled(monkeypatch):
    from app.auth import get_user_roles, grant_role
    from app.auth.provisioning import sync_user_roles_from_identity
    from app.auth.role_overrides import RoleOverrides, set_user_role_overrides
    from app.db import get_session, init_db
    from app.models import User

    init_db()
    monkeypatch.setenv("OIDC_GROUP_ROLE_MAP", "team-auto=auto-role")
    monkeypatch.setenv("OIDC_GROUP_ROLE_DEFAULTS", "")

    with next(get_session()) as session:
        user = User(id="override-enabled")
        session.add(user)
        session.commit()

        user = session.get(User, user.id)
        grant_role(session, user.id, "auto-role", create_missing=True)
        grant_role(session, user.id, "manual-role", create_missing=True)
        session.commit()

        user = session.get(User, user.id)
        overrides = RoleOverrides.from_iterables(preserve=["manual-role"], enabled=True)
        set_user_role_overrides(user, overrides=overrides)
        session.add(user)
        session.commit()

        changed = sync_user_roles_from_identity(session, user, {"groups": []})
        # No roles should be revoked when overrides are enabled
        assert changed is False
        session.commit()

    with next(get_session()) as session:
        roles = set(get_user_roles(session, "override-enabled"))
        assert roles == {"auto-role", "manual-role"}


def test_ensure_user_from_identity_preserves_role_overrides(monkeypatch):
    from app.auth.role_overrides import RoleOverrides, get_user_role_overrides, set_user_role_overrides
    from app.auth.users import ensure_user_from_identity
    from app.db import get_session, init_db

    init_db()
    identity = {
        "sub": "override-preserve",
        "email": "override@example.com",
        "name": "Override User",
        "claims": {"source": "initial"},
    }

    with next(get_session()) as session:
        user, created, updated = ensure_user_from_identity(session, identity)
        assert created is True
        assert updated is False
        overrides = RoleOverrides.from_iterables(preserve=["keep-me"])
        set_user_role_overrides(user, overrides=overrides)
        session.add(user)
        session.commit()

    new_identity = dict(identity)
    new_identity["name"] = "Override User Updated"
    new_identity["claims"] = {"source": "updated"}

    with next(get_session()) as session:
        user, created, updated = ensure_user_from_identity(session, new_identity)
        assert created is False
        assert updated is True
        assert get_user_role_overrides(user) == RoleOverrides.from_iterables(preserve=["keep-me"])
