from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import select


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))


@pytest.fixture()
def admin_client():
    from app.main import create_app
    from app.db import init_db
    from app.auth.oidc import get_current_user

    init_db()
    app = create_app()
    identity = {
        "sub": "admin-1",
        "email": "admin@example.com",
        "name": "Admin",
        "groups": ["admin"],
    }
    app.dependency_overrides[get_current_user] = lambda: identity
    client = TestClient(app)
    try:
        yield client
    finally:
        app.dependency_overrides.clear()


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
    assert payload["total"] == 2
    assert payload["has_next"] is False
    items = {item["id"]: item for item in payload["items"]}
    assert items["user-1"]["roles"] == ["editor"]
    assert items["user-1"]["groups"] == []
    assert items["user-1"]["is_admin"] is False
    assert items["user-2"]["roles"] == []
    assert items["user-2"]["groups"] == ["managers"]

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
    resp_revoke = admin_client.delete("/v1/admin/users/user-1/roles/editor")
    assert resp_revoke.status_code == 204

    # User detail should reflect updated roles
    resp_detail = admin_client.get("/v1/admin/users/user-1")
    assert resp_detail.status_code == 200
    assert "editor" not in resp_detail.json()["roles"]

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
