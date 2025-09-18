from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import select


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.setenv("USER_MGMT_CORE", "1")
    from app.config import is_user_mgmt_core_enabled

    is_user_mgmt_core_enabled.cache_clear()


@pytest.fixture()
def admin_client():
    from app.auth import ADMIN_ROLE_NAME, ensure_admin_role, grant_role
    from app.db import get_session, init_db
    from app.main import create_app
    from app.auth.oidc import get_current_user
    from app.models import User

    init_db()
    identity = {
        "sub": "admin-1",
        "email": "admin@example.com",
        "name": "Admin",
        "groups": ["admin"],
    }

    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: identity
    client = TestClient(app)
    with next(get_session()) as session:
        ensure_admin_role(session)
        session.commit()
        admin_user = session.get(User, identity["sub"])
        if admin_user is None:
            admin_user = User(
                id=identity["sub"],
                email=identity["email"],
                full_name=identity["name"],
                claims={"groups": identity.get("groups", [])},
            )
        if session.get(User, admin_user.id) is None:
            session.add(admin_user)
            session.commit()
        grant_role(
            session,
            admin_user.id,
            ADMIN_ROLE_NAME,
            granted_by_user_id=admin_user.id,
        )
        session.commit()
    try:
        yield client
    finally:
        app.dependency_overrides.clear()


def test_admin_role_ensured_on_startup():
    from app.auth import ADMIN_ROLE_NAME
    from app.db import get_session_ctx, init_db
    from app.main import create_app
    from app.models import Role

    init_db()
    app = create_app()
    with TestClient(app):
        pass

    with get_session_ctx() as session:
        role = session.exec(select(Role).where(Role.name == ADMIN_ROLE_NAME)).first()
        assert role is not None
        assert role.is_system is True


def test_admin_routes_hidden_when_flag_disabled(monkeypatch):
    from app.config import is_user_mgmt_core_enabled
    from app.db import init_db
    from app.main import create_app

    is_user_mgmt_core_enabled.cache_clear()
    monkeypatch.setenv("USER_MGMT_CORE", "0")
    init_db()
    app = create_app()
    with TestClient(app) as client:
        resp_users = client.get("/v1/admin/users")
        assert resp_users.status_code == 404
        resp_audit = client.get("/v1/admin/audit")
        assert resp_audit.status_code == 404
    is_user_mgmt_core_enabled.cache_clear()


def test_admin_users_listing_and_role_management(admin_client):
    from app.auth import ensure_role, grant_role
    from app.db import get_session
    from app.models import AuditLog, User

    with next(get_session()) as session:
        user1 = User(id="user-1", email="one@example.com", full_name="User One")
        user2 = User(
            id="user-2",
            email="two@example.com",
            full_name="User Two",
            claims={"groups": ["managers"]},
        )
        session.add(user1)
        session.add(user2)
        session.commit()

        ensure_role(session, "editor", description="Can edit resources")
        session.commit()
        grant_role(session, user1.id, "editor", granted_by_user_id="admin-1")
        session.commit()

    resp = admin_client.get("/v1/admin/users")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["total"] >= 2
    assert payload["has_next"] is False
    items = {item["id"]: item for item in payload["items"]}
    assert "admin-1" in items
    assert items["admin-1"]["is_admin"] is True
    assert "user-1" in items
    assert "user-2" in items
    assert items["user-1"]["roles"] == ["editor"]
    assert items["user-1"]["groups"] == []
    assert items["user-1"]["is_admin"] is False
    assert items["user-1"]["quota_credentials"] is None
    assert items["user-1"]["quota_site_configs"] is None
    assert items["user-1"]["quota_feeds"] is None
    assert items["user-1"]["quota_api_tokens"] is None
    assert items["user-2"]["roles"] == []
    assert items["user-2"]["groups"] == ["managers"]
    assert items["user-2"]["quota_credentials"] is None

    # Role filter should match user-1 initially
    resp_role = admin_client.get("/v1/admin/users", params={"role": "editor"})
    assert resp_role.status_code == 200
    assert resp_role.json()["total"] == 1

    # Search should be case-insensitive
    resp_search = admin_client.get("/v1/admin/users", params={"search": "user two"})
    assert resp_search.status_code == 200
    assert resp_search.json()["total"] == 1

    # Grant a new role to the second user (auto-creating the role)
    resp_grant = admin_client.post(
        "/v1/admin/users/user-2/roles/reviewer",
        json={"create_missing": True, "description": "Can review"},
    )
    assert resp_grant.status_code == 200
    assert "reviewer" in resp_grant.json()["roles"]

    # Role filter should now include the second user
    resp_reviewer = admin_client.get("/v1/admin/users", params={"role": "reviewer"})
    assert resp_reviewer.status_code == 200
    assert resp_reviewer.json()["total"] == 1

    # Revoke the original role from user-1
    resp_revoke = admin_client.delete(
        "/v1/admin/users/user-1/roles/editor",
        params={"confirm": "true"},
    )
    assert resp_revoke.status_code == 204

    # User detail should reflect updated roles
    resp_detail = admin_client.get("/v1/admin/users/user-1")
    assert resp_detail.status_code == 200
    detail_payload = resp_detail.json()
    assert "editor" not in detail_payload["roles"]
    assert detail_payload["quota_credentials"] is None

    # Role filter should now yield zero results for the revoked role
    resp_role_after = admin_client.get("/v1/admin/users", params={"role": "editor"})
    assert resp_role_after.status_code == 200
    assert resp_role_after.json()["total"] == 0

    with next(get_session()) as session:
        audit = session.exec(
            select(AuditLog).where(AuditLog.entity_type == "user_role").order_by(AuditLog.created_at)
        ).all()
        actions = [entry.action for entry in audit]
        assert "grant" in actions
        assert "revoke" in actions


def test_admin_users_requires_admin_privileges():
    from app.main import create_app
    from app.db import init_db
    from app.auth.oidc import get_current_user

    init_db()
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "user-x", "groups": []}
    client = TestClient(app)

    resp = client.get("/v1/admin/users")
    assert resp.status_code == 403


def test_admin_users_allows_db_admin_role():
    from app.auth import ADMIN_ROLE_NAME, ensure_admin_role, grant_role
    from app.auth.oidc import get_current_user
    from app.db import get_session, init_db
    from app.main import create_app
    from app.models import User

    init_db()
    with next(get_session()) as session:
        ensure_admin_role(session)
        session.commit()
        admin_user = User(id="role-admin", email="role@example.com")
        session.add(admin_user)
        session.commit()
        grant_role(session, admin_user.id, ADMIN_ROLE_NAME)
        session.commit()

    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "role-admin", "groups": []}
    client = TestClient(app)

    resp = client.get("/v1/admin/users")
    assert resp.status_code == 200


def test_admin_user_suspend_requires_confirmation(admin_client):
    from app.db import get_session
    from app.models import User

    with next(get_session()) as session:
        session.add(User(id="confirm-user", email="confirm@example.com"))
        session.commit()

    resp_missing = admin_client.patch(
        "/v1/admin/users/confirm-user",
        json={"is_active": False},
    )
    assert resp_missing.status_code == 400

    resp_confirmed = admin_client.patch(
        "/v1/admin/users/confirm-user",
        json={"is_active": False, "confirm": True},
    )
    assert resp_confirmed.status_code == 200
    assert resp_confirmed.json()["is_active"] is False


def test_admin_revoke_requires_confirmation(admin_client):
    from app.auth import ensure_role, grant_role
    from app.db import get_session
    from app.models import User

    with next(get_session()) as session:
        ensure_role(session, "moderator")
        session.commit()
        user = User(id="revoke-user", email="revoke@example.com")
        session.add(user)
        session.commit()
        grant_role(session, user.id, "moderator")
        session.commit()

    resp_missing = admin_client.delete("/v1/admin/users/revoke-user/roles/moderator")
    assert resp_missing.status_code == 400

    resp_ok = admin_client.delete(
        "/v1/admin/users/revoke-user/roles/moderator",
        params={"confirm": "true"},
    )
    assert resp_ok.status_code == 204


def test_admin_user_quota_updates(admin_client):
    from app.db import get_session
    from app.models import User

    with next(get_session()) as session:
        session.add(User(id="quota-user", email="quota@example.com"))
        session.commit()

    resp = admin_client.patch(
        "/v1/admin/users/quota-user",
        json={
            "quota_credentials": 5,
            "quota_site_configs": 2,
            "quota_feeds": 3,
            "quota_api_tokens": 4,
        },
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["quota_credentials"] == 5
    assert payload["quota_site_configs"] == 2
    assert payload["quota_feeds"] == 3
    assert payload["quota_api_tokens"] == 4

    with next(get_session()) as session:
        user = session.get(User, "quota-user")
        assert user.quota_credentials == 5
        assert user.quota_site_configs == 2
        assert user.quota_feeds == 3
        assert user.quota_api_tokens == 4

    resp_reset = admin_client.patch(
        "/v1/admin/users/quota-user",
        json={"quota_credentials": None, "quota_feeds": 1},
    )
    assert resp_reset.status_code == 200
    reset_payload = resp_reset.json()
    assert reset_payload["quota_credentials"] is None
    assert reset_payload["quota_feeds"] == 1

    with next(get_session()) as session:
        user = session.get(User, "quota-user")
        assert user.quota_credentials is None
        assert user.quota_feeds == 1


def test_require_admin_respects_session_user(monkeypatch):
    from app.auth import ADMIN_ROLE_NAME, ensure_admin_role, grant_role
    from app.db import get_session_ctx, init_db
    from app.models import User
    from app.routers.admin import _require_admin

    init_db()
    with get_session_ctx() as session:
        ensure_admin_role(session)
        session.commit()
        user = User(id="admin-ctx", email="ctx@example.com")
        session.add(user)
        session.commit()
        grant_role(session, user.id, ADMIN_ROLE_NAME)
        session.commit()

        monkeypatch.setattr("app.routers.admin.get_session_user_id", lambda _: "admin-ctx")
        current_user = {"sub": "admin-ctx", "groups": []}
        assert _require_admin(session, current_user) == "admin-ctx"

        monkeypatch.setattr("app.routers.admin.get_session_user_id", lambda _: "admin-ctx")
        with pytest.raises(HTTPException) as excinfo:
            _require_admin(session, {"sub": "other", "groups": []})
        assert excinfo.value.status_code == 403

        monkeypatch.setattr("app.routers.admin.get_session_user_id", lambda _: None)
        assert _require_admin(session, current_user) == "admin-ctx"
