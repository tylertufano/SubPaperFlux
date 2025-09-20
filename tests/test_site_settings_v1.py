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


def test_get_welcome_setting_defaults(app):
    client = TestClient(app)

    response = client.get("/v1/site-settings/welcome")
    assert response.status_code == 200
    payload = response.json()

    assert payload["key"] == "welcome"
    assert isinstance(payload["value"], dict)
    assert payload["value"].get("headline") is None
    assert payload.get("updated_at") is None
    assert payload.get("updated_by_user_id") is None


def test_admin_can_update_welcome_setting(app):
    from app.auth.oidc import get_current_user
    from app.db import get_session
    from app.models import AuditLog, SiteSetting

    identity = {
        "sub": "admin-001",
        "email": "admin@example.com",
        "name": "Admin User",
        "groups": ["admin"],
    }

    app.dependency_overrides[get_current_user] = lambda: identity
    client = TestClient(app)

    with next(get_session()) as session:
        _ensure_user(session, identity, grant_admin=True)

    update_payload = {
        "headline": "Welcome to SubPaperFlux",
        "body": "Capture your reading in one place.",
        "cta_text": "Get started",
    }

    response = client.put("/v1/site-settings/welcome", json=update_payload)
    assert response.status_code == 200
    payload = response.json()

    assert payload["key"] == "welcome"
    assert payload["value"]["headline"] == update_payload["headline"]
    assert payload["value"]["body"] == update_payload["body"]
    assert payload["updated_by_user_id"] == identity["sub"]
    assert payload["created_at"] is not None
    assert payload["updated_at"] is not None

    follow_up = client.get("/v1/site-settings/welcome")
    assert follow_up.status_code == 200
    follow_payload = follow_up.json()
    assert follow_payload["value"]["cta_text"] == update_payload["cta_text"]

    with next(get_session()) as session:
        setting = session.get(SiteSetting, "welcome")
        assert setting is not None
        assert setting.value.get("headline") == update_payload["headline"]

        audit_entries = session.exec(
            select(AuditLog).where(AuditLog.entity_type == "site_setting")
        ).all()
        assert len(audit_entries) == 1
        entry = audit_entries[0]
        assert entry.action == "update"
        assert entry.actor_user_id == identity["sub"]
        assert entry.details.get("value", {}).get("body") == update_payload["body"]


def test_non_admin_cannot_update_welcome_setting(app):
    from app.auth.oidc import get_current_user
    from app.db import get_session
    from app.models import AuditLog, SiteSetting

    identity = {
        "sub": "user-001",
        "email": "user@example.com",
        "name": "Regular User",
        "groups": [],
    }

    app.dependency_overrides[get_current_user] = lambda: identity
    client = TestClient(app)

    with next(get_session()) as session:
        _ensure_user(session, identity, grant_admin=False)

    response = client.patch(
        "/v1/site-settings/welcome",
        json={"headline": "Unauthorized"},
    )
    assert response.status_code == 403

    with next(get_session()) as session:
        assert session.get(SiteSetting, "welcome") is None
        audit_entries = session.exec(
            select(AuditLog).where(AuditLog.entity_type == "site_setting")
        ).all()
        assert audit_entries == []
