from __future__ import annotations

from pathlib import Path
from typing import Callable, Dict

import pytest
from fastapi.testclient import TestClient


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


def _make_identity() -> Dict[str, object]:
    return {
        "sub": "oidc-user",
        "email": "user@example.com",
        "name": "OIDC User",
        "picture": "https://example.com/avatar.png",
        "claims": {"groups": ["staff"]},
    }


def _setup_app(
    monkeypatch, identity: Dict[str, object] | Callable[[], Dict[str, object]]
) -> TestClient:
    from app.db import init_db
    from app.main import create_app

    init_db()

    def _resolve_identity(
        token: object,
        userinfo_bearer: object | None = None,
    ) -> Dict[str, object]:
        return identity() if callable(identity) else identity

    monkeypatch.setattr("app.auth.oidc.resolve_user_from_token", _resolve_identity)
    monkeypatch.setattr("app.main.resolve_user_from_token", _resolve_identity)
    app = create_app()
    return TestClient(app)


def test_auto_provision_creates_user_and_role(monkeypatch):
    from app.auth import get_user_roles
    from app.db import get_session
    from app.models import User

    identity = _make_identity()
    monkeypatch.setenv("OIDC_AUTO_PROVISION_USERS", "1")
    monkeypatch.setenv("OIDC_AUTO_PROVISION_DEFAULT_ROLE", "member")

    client = _setup_app(monkeypatch, identity)
    with client:
        resp = client.get("/v1/feeds", headers={"Authorization": "Bearer test"})
        assert resp.status_code == 200

    with next(get_session()) as session:
        user = session.get(User, identity["sub"])
        assert user is not None
        assert user.email == identity["email"]
        assert user.full_name == identity["name"]
        assert user.claims == identity["claims"]
        assert user.last_login_at is not None
        assert "member" in get_user_roles(session, user.id)


def test_auto_provision_disabled(monkeypatch):
    from app.db import get_session
    from app.models import User

    identity = _make_identity()
    monkeypatch.delenv("OIDC_AUTO_PROVISION_USERS", raising=False)
    monkeypatch.delenv("OIDC_AUTO_PROVISION_DEFAULT_ROLE", raising=False)

    client = _setup_app(monkeypatch, identity)
    with client:
        resp = client.get("/v1/feeds", headers={"Authorization": "Bearer test"})
        assert resp.status_code == 200

    with next(get_session()) as session:
        assert session.get(User, identity["sub"]) is None


def test_auto_provision_respects_user_mgmt_flag(monkeypatch):
    from app.db import get_session
    from app.models import User
    from app.config import is_user_mgmt_core_enabled

    identity = _make_identity()
    monkeypatch.setenv("OIDC_AUTO_PROVISION_USERS", "1")
    is_user_mgmt_core_enabled.cache_clear()
    monkeypatch.setenv("USER_MGMT_CORE", "0")

    client = _setup_app(monkeypatch, identity)
    with client:
        resp = client.get("/v1/feeds", headers={"Authorization": "Bearer test"})
        assert resp.status_code == 200

    with next(get_session()) as session:
        assert session.get(User, identity["sub"]) is None
    is_user_mgmt_core_enabled.cache_clear()


def test_auto_provision_assigns_roles_from_group_mapping(monkeypatch):
    from app.auth import get_user_roles
    from app.db import get_session
    from app.models import User

    identity = _make_identity()
    identity["claims"]["groups"] = [" team-one ", "team-two", "unknown", ""]
    monkeypatch.setenv("OIDC_AUTO_PROVISION_USERS", "1")
    monkeypatch.setenv("OIDC_AUTO_PROVISION_DEFAULT_ROLE", "member")
    monkeypatch.setenv(
        "OIDC_GROUP_ROLE_MAP",
        "team-one=role-alpha,team-two=role-beta\nteam-one=role-gamma",
    )
    monkeypatch.setenv("OIDC_GROUP_ROLE_DEFAULTS", "default-role")

    client = _setup_app(monkeypatch, identity)
    with client:
        resp = client.get("/v1/feeds", headers={"Authorization": "Bearer test"})
        assert resp.status_code == 200

    with next(get_session()) as session:
        user = session.get(User, identity["sub"])
        assert user is not None
        roles = set(get_user_roles(session, user.id))
        assert roles == {
            "default-role",
            "member",
            "role-alpha",
            "role-beta",
            "role-gamma",
        }


def test_auto_provision_respects_role_overrides(monkeypatch):
    from app.auth import get_user_roles, grant_role
    from app.auth.role_overrides import RoleOverrides, set_user_role_overrides
    from app.db import get_session
    from app.models import User

    base_identity = _make_identity()
    base_identity["sub"] = "override-user"
    base_identity["claims"]["groups"] = ["team-auto"]

    identity_state = {"current": base_identity}

    def _identity_source() -> Dict[str, object]:
        return identity_state["current"]

    monkeypatch.setenv("OIDC_AUTO_PROVISION_USERS", "1")
    monkeypatch.setenv("OIDC_AUTO_PROVISION_DEFAULT_ROLE", "member")
    monkeypatch.setenv("OIDC_GROUP_ROLE_MAP", "team-auto=auto-role")
    monkeypatch.setenv("OIDC_GROUP_ROLE_DEFAULTS", "")

    client = _setup_app(monkeypatch, _identity_source)
    headers = {"Authorization": "Bearer test"}

    with client:
        first_resp = client.get("/v1/feeds", headers=headers)
        assert first_resp.status_code == 200

        with next(get_session()) as session:
            user = session.get(User, base_identity["sub"])
            assert user is not None
            assert set(get_user_roles(session, user.id)) == {"auto-role", "member"}

            grant_role(session, user.id, "manual-role", create_missing=True)
            overrides = RoleOverrides.from_iterables(
                preserve=["manual-role"], enabled=True
            )
            set_user_role_overrides(user, overrides=overrides)
            session.add(user)
            session.commit()

        updated_identity = dict(base_identity)
        updated_identity["claims"] = {}
        identity_state["current"] = updated_identity

        second_resp = client.get("/v1/feeds", headers=headers)
        assert second_resp.status_code == 200

    with next(get_session()) as session:
        user = session.get(User, base_identity["sub"])
        assert user is not None
        assert set(get_user_roles(session, user.id)) == {
            "auto-role",
            "manual-role",
            "member",
        }
