from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(root))
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.setenv("SCIM_ENABLED", "1")
    monkeypatch.setenv("SCIM_WRITE_ENABLED", "1")

    from app.config import is_scim_enabled, is_scim_write_enabled

    is_scim_enabled.cache_clear()
    is_scim_write_enabled.cache_clear()
    try:
        yield
    finally:
        is_scim_enabled.cache_clear()
        is_scim_write_enabled.cache_clear()


@pytest.fixture()
def admin_client():
    from app.auth import ADMIN_ROLE_NAME, ensure_admin_role, grant_role
    from app.auth.oidc import get_current_user
    from app.db import get_session, init_db
    from app.main import create_app
    from app.models import User

    init_db()
    with next(get_session()) as session:
        admin = session.get(User, "admin-user")
        if admin is None:
            admin = User(id="admin-user", email="admin@example.com", full_name="Admin User")
        session.add(admin)
        ensure_admin_role(session)
        session.commit()
        grant_role(session, admin.id, ADMIN_ROLE_NAME, create_missing=True)
        session.commit()

    app = create_app()
    identity = {
        "sub": "admin-user",
        "email": "admin@example.com",
        "name": "Admin User",
        "groups": ["admin"],
    }
    app.dependency_overrides[get_current_user] = lambda: identity
    client = TestClient(app)
    try:
        yield client
    finally:
        app.dependency_overrides.clear()


def test_scim_user_lifecycle(admin_client):
    create_payload = {
        "userName": "user@example.com",
        "displayName": "Example User",
        "active": True,
    }
    created = admin_client.post("/scim/v2/Users", json=create_payload)
    assert created.status_code == 201
    created_data = created.json()
    assert created_data["userName"] == "user@example.com"
    assert created_data["displayName"] == "Example User"
    user_id = created_data["id"]

    update_payload = {
        "userName": "user@example.com",
        "displayName": "Updated User",
        "active": False,
    }
    updated = admin_client.put(f"/scim/v2/Users/{user_id}", json=update_payload)
    assert updated.status_code == 200
    updated_data = updated.json()
    assert updated_data["displayName"] == "Updated User"
    assert updated_data["active"] is False

    deleted = admin_client.delete(f"/scim/v2/Users/{user_id}")
    assert deleted.status_code == 204

    from app.db import get_session
    from app.models import User

    with next(get_session()) as session:
        assert session.get(User, user_id) is None


def test_scim_group_lifecycle(admin_client):
    from tests.factories import create_user

    member = create_user(user_id="member-1", email="member@example.com", full_name="Member One")

    create_payload = {
        "displayName": "Research Group",
        "members": [{"value": member.id}],
    }
    created = admin_client.post("/scim/v2/Groups", json=create_payload)
    assert created.status_code == 201
    created_data = created.json()
    group_id = created_data["id"]
    assert created_data["displayName"] == "Research Group"
    assert {member["value"] for member in created_data["members"]} == {member.id}

    update_payload = {
        "displayName": "Updated Research Group",
        "members": [],
    }
    updated = admin_client.put(f"/scim/v2/Groups/{group_id}", json=update_payload)
    assert updated.status_code == 200
    updated_data = updated.json()
    assert updated_data["displayName"] == "Updated Research Group"
    assert updated_data["members"] == []

    deleted = admin_client.delete(f"/scim/v2/Groups/{group_id}")
    assert deleted.status_code == 204

    from app.db import get_session
    from app.models import Organization

    with next(get_session()) as session:
        assert session.get(Organization, group_id) is None
