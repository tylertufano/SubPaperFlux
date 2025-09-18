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
def admin_client(monkeypatch):
    from app.auth import ADMIN_ROLE_NAME, ensure_admin_role, grant_role
    from app.auth.oidc import get_current_user
    from app.db import get_session, init_db
    from app.main import create_app
    from app.models import User

    init_db()
    identity = {
        "sub": "admin-123",
        "email": "admin@example.com",
        "name": "Admin Tester",
        "groups": ["admin"],
    }

    app = create_app()

    monkeypatch.setattr("app.routers.admin.is_postgres", lambda: True)
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


def test_postgres_prepare_records_audit_log(admin_client, monkeypatch):
    from app.db import get_session
    from app.models import AuditLog
    from app.routers import admin as admin_module

    stub_details = {"ok": True, "actions": ["ensured_pg_trgm"]}

    monkeypatch.setattr(admin_module, "prepare_postgres_search", lambda session: stub_details)

    response = admin_client.post("/admin/postgres/prepare")
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["details"] == stub_details

    with next(get_session()) as session:
        entries = session.exec(
            select(AuditLog).where(AuditLog.action == "postgres_prepare")
        ).all()

    assert len(entries) == 1
    entry = entries[0]
    assert entry.entity_type == "admin_action"
    assert entry.entity_id == "postgres_prepare"
    assert entry.owner_user_id == "admin-123"
    assert entry.actor_user_id == "admin-123"
    assert entry.details == stub_details


def test_postgres_enable_rls_records_audit_log(admin_client, monkeypatch):
    from app.db import get_session
    from app.models import AuditLog
    from app.routers import admin as admin_module

    stub_details = {
        "ok": False,
        "tables": {"siteconfig": {"enabled": True, "policies": {}}},
    }

    monkeypatch.setattr(admin_module, "enable_rls", lambda session: stub_details)

    response = admin_client.post("/admin/postgres/enable-rls")
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["details"] == stub_details

    with next(get_session()) as session:
        entries = session.exec(
            select(AuditLog).where(AuditLog.action == "postgres_enable_rls")
        ).all()

    assert len(entries) == 1
    entry = entries[0]
    assert entry.entity_type == "admin_action"
    assert entry.entity_id == "postgres_enable_rls"
    assert entry.owner_user_id == "admin-123"
    assert entry.actor_user_id == "admin-123"
    assert entry.details == stub_details
