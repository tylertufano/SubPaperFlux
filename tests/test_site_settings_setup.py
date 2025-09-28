from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlmodel import select


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.setenv("USER_MGMT_CORE", "1")
    from app.config import is_user_mgmt_core_enabled

    is_user_mgmt_core_enabled.cache_clear()
    yield
    is_user_mgmt_core_enabled.cache_clear()


@pytest.fixture()
def app():
    from app.db import init_db
    from app.main import create_app

    init_db()
    application = create_app()
    try:
        yield application
    finally:
        application.dependency_overrides.clear()


def _ensure_user(session, identity, *, grant_admin: bool = False):
    from app.auth import ADMIN_ROLE_NAME, ensure_admin_role, grant_role
    from app.models import User

    ensure_admin_role(session)
    session.commit()

    user = session.get(User, identity["sub"])
    if user is None:
        user = User(
            id=identity["sub"],
            email=identity.get("email"),
            full_name=identity.get("name"),
            claims={"groups": identity.get("groups", [])},
        )
        session.add(user)
        session.commit()

    if grant_admin:
        grant_role(session, user.id, ADMIN_ROLE_NAME, granted_by_user_id=user.id)
        session.commit()

    return user


def test_admin_can_read_default_setup_status(app):
    from app.auth.oidc import get_current_user
    from app.db import get_session

    identity = {
        "sub": "admin-setup-001",
        "email": "setup-admin@example.com",
        "name": "Setup Admin",
        "groups": ["admin"],
    }

    app.dependency_overrides[get_current_user] = lambda: identity
    client = TestClient(app)

    with next(get_session()) as session:
        _ensure_user(session, identity, grant_admin=True)

    response = client.get("/v1/site-settings/setup-status")
    assert response.status_code == 200
    payload = response.json()

    assert payload["key"] == "setup_status"
    assert payload["value"]["completed"] is False
    assert payload["value"].get("current_step") is None
    assert payload["updated_at"] is None
    assert payload["updated_by_user_id"] is None


def test_admin_can_update_setup_status(app):
    from app.auth.oidc import get_current_user
    from app.db import get_session
    from app.models import AuditLog, SiteSetting

    identity = {
        "sub": "admin-setup-002",
        "email": "setup-admin2@example.com",
        "name": "Setup Admin",
        "groups": ["admin"],
    }

    app.dependency_overrides[get_current_user] = lambda: identity
    client = TestClient(app)

    with next(get_session()) as session:
        _ensure_user(session, identity, grant_admin=True)

    payload = {
        "completed": False,
        "current_step": "credentials",
        "last_completed_step": "welcome",
        "welcome_configured": True,
    }

    response = client.put("/v1/site-settings/setup-status", json=payload)
    assert response.status_code == 200
    body = response.json()

    assert body["value"]["current_step"] == "credentials"
    assert body["value"]["last_completed_step"] == "welcome"
    assert body["value"]["welcome_configured"] is True
    assert body["updated_by_user_id"] == identity["sub"]
    assert body["updated_at"] is not None

    follow_up = client.get("/v1/site-settings/setup-status")
    assert follow_up.status_code == 200
    follow_payload = follow_up.json()
    assert follow_payload["value"]["current_step"] == "credentials"

    with next(get_session()) as session:
        setting = session.get(SiteSetting, "setup_status")
        assert setting is not None
        assert setting.value.get("last_completed_step") == "welcome"

        audit_entries = session.exec(
            select(AuditLog).where(AuditLog.entity_id == "setup_status")
        ).all()
        assert len(audit_entries) == 1
        entry = audit_entries[0]
        assert entry.action == "update"
        assert entry.actor_user_id == identity["sub"]
        assert entry.details.get("value", {}).get("current_step") == "credentials"


def test_non_admin_cannot_access_setup_status(app):
    from app.auth.oidc import get_current_user
    from app.db import get_session
    from app.models import SiteSetting

    identity = {
        "sub": "user-setup-003",
        "email": "user@example.com",
        "name": "Regular User",
        "groups": [],
    }

    app.dependency_overrides[get_current_user] = lambda: identity
    client = TestClient(app)

    with next(get_session()) as session:
        _ensure_user(session, identity, grant_admin=False)

    get_response = client.get("/v1/site-settings/setup-status")
    assert get_response.status_code == 403

    put_response = client.put(
        "/v1/site-settings/setup-status",
        json={"completed": True},
    )
    assert put_response.status_code == 403

    with next(get_session()) as session:
        assert session.get(SiteSetting, "setup_status") is None
