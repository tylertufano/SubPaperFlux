from pathlib import Path

import pytest
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
    yield
    is_user_mgmt_core_enabled.cache_clear()


@pytest.fixture()
def admin_client():
    from app.auth import ADMIN_ROLE_NAME, ensure_admin_role, grant_role
    from app.auth.oidc import get_current_user
    from app.db import get_session, init_db
    from app.main import create_app
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
        client.close()


def test_admin_roles_routes_hidden_when_flag_disabled(monkeypatch):
    from app.config import is_user_mgmt_core_enabled
    from app.db import init_db
    from app.main import create_app

    is_user_mgmt_core_enabled.cache_clear()
    monkeypatch.setenv("USER_MGMT_CORE", "0")
    init_db()
    app = create_app()

    with TestClient(app) as client:
        resp_list = client.get("/v1/admin/roles")
        assert resp_list.status_code == 404
        resp_create = client.post("/v1/admin/roles", json={"name": "test"})
        assert resp_create.status_code == 404

    is_user_mgmt_core_enabled.cache_clear()


def test_admin_roles_requires_admin_privileges():
    from app.auth.oidc import get_current_user
    from app.db import init_db
    from app.main import create_app

    init_db()
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "user-x", "groups": []}
    client = TestClient(app)

    try:
        resp = client.get("/v1/admin/roles")
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()
        client.close()


def test_admin_roles_crud_and_assignment_counts(admin_client):
    from app.auth import grant_role
    from app.db import get_session
    from app.models import AuditLog, Role, User

    with next(get_session()) as session:
        session.add(User(id="role-user-1", email="one@example.com"))
        session.add(User(id="role-user-2", email="two@example.com"))
        session.commit()

    resp_create = admin_client.post(
        "/v1/admin/roles",
        json={"name": "Editors", "description": "Can edit resources"},
    )
    assert resp_create.status_code == 201
    created_payload = resp_create.json()
    role_id = created_payload["id"]
    assert created_payload["assigned_user_count"] == 0

    with next(get_session()) as session:
        role = session.get(Role, role_id)
        assert role is not None
        audit_create = session.exec(
            select(AuditLog).where(
                AuditLog.entity_type == "role",
                AuditLog.entity_id == role_id,
                AuditLog.action == "create",
            )
        ).first()
        assert audit_create is not None
        assert audit_create.details["name"] == "Editors"

    resp_list = admin_client.get("/v1/admin/roles")
    assert resp_list.status_code == 200
    list_payload = resp_list.json()
    items = {item["id"]: item for item in list_payload["items"]}
    assert items[role_id]["assigned_user_count"] == 0

    with next(get_session()) as session:
        grant_role(session, "role-user-1", created_payload["name"], granted_by_user_id="admin-1")
        session.commit()

    resp_detail_after_first = admin_client.get(f"/v1/admin/roles/{role_id}")
    assert resp_detail_after_first.status_code == 200
    detail_payload = resp_detail_after_first.json()
    assert detail_payload["assigned_user_count"] == 1

    resp_update = admin_client.patch(
        f"/v1/admin/roles/{role_id}",
        json={
            "name": "Senior Editors",
            "description": "Updated description",
        },
    )
    assert resp_update.status_code == 200
    update_payload = resp_update.json()
    assert update_payload["name"] == "Senior Editors"
    assert update_payload["assigned_user_count"] == 1

    with next(get_session()) as session:
        audit_update = session.exec(
            select(AuditLog).where(
                AuditLog.entity_type == "role",
                AuditLog.entity_id == role_id,
                AuditLog.action == "update",
            )
        ).first()
        assert audit_update is not None
        assert "name" in audit_update.details["changes"]

    with next(get_session()) as session:
        grant_role(session, "role-user-2", update_payload["name"], granted_by_user_id="admin-1")
        session.commit()

    resp_detail_after_second = admin_client.get(f"/v1/admin/roles/{role_id}")
    assert resp_detail_after_second.status_code == 200
    detail_after_second = resp_detail_after_second.json()
    assert detail_after_second["assigned_user_count"] == 2

    resp_list_after_assignments = admin_client.get("/v1/admin/roles")
    assert resp_list_after_assignments.status_code == 200
    list_after_assignments = resp_list_after_assignments.json()
    items_after_assignments = {item["id"]: item for item in list_after_assignments["items"]}
    assert items_after_assignments[role_id]["assigned_user_count"] == 2

    resp_delete = admin_client.delete(f"/v1/admin/roles/{role_id}")
    assert resp_delete.status_code == 204

    with next(get_session()) as session:
        assert session.get(Role, role_id) is None
        audit_delete = session.exec(
            select(AuditLog).where(
                AuditLog.entity_type == "role",
                AuditLog.entity_id == role_id,
                AuditLog.action == "delete",
            )
        ).first()
        assert audit_delete is not None
        assert audit_delete.details["name"] == "Senior Editors"

    resp_list_after_delete = admin_client.get("/v1/admin/roles")
    assert resp_list_after_delete.status_code == 200
    remaining_ids = {item["id"] for item in resp_list_after_delete.json()["items"]}
    assert role_id not in remaining_ids


def test_admin_roles_system_role_protected(admin_client):
    from app.auth import ADMIN_ROLE_NAME
    from app.db import get_session
    from app.models import Role

    with next(get_session()) as session:
        admin_role = session.exec(select(Role).where(Role.name == ADMIN_ROLE_NAME)).one()

    resp_rename = admin_client.patch(
        f"/v1/admin/roles/{admin_role.id}",
        json={"name": "Super Admin"},
    )
    assert resp_rename.status_code == 400
    assert resp_rename.json()["message"] == "System roles cannot be renamed"

    resp_delete = admin_client.delete(f"/v1/admin/roles/{admin_role.id}")
    assert resp_delete.status_code == 400
    assert resp_delete.json()["message"] == "Cannot delete system roles"
