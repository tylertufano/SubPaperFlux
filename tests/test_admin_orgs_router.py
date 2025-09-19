from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import select

from tests.factories import create_organization, create_user


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
        "sub": "admin-org", 
        "email": "admin-org@example.com",
        "name": "Admin Org",
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


def test_admin_orgs_list_and_detail(admin_client):
    create_user(user_id="org-user-1", email="one@example.com", full_name="Org User One")
    create_user(user_id="org-user-2", email="two@example.com", full_name="Org User Two")

    alpha = create_organization(
        slug="alpha-org",
        name="Alpha Org",
        description="Alpha description",
        member_ids=["org-user-1", "org-user-2"],
    )
    beta = create_organization(slug="beta-org", name="Beta Org")

    resp_list = admin_client.get("/v1/admin/orgs")
    assert resp_list.status_code == 200
    payload = resp_list.json()
    assert payload["total"] == 2
    items = {item["slug"]: item for item in payload["items"]}
    assert items["alpha-org"]["member_count"] == 2
    assert items["beta-org"]["member_count"] == 0

    resp_detail = admin_client.get(f"/v1/admin/orgs/{alpha.id}")
    assert resp_detail.status_code == 200
    detail = resp_detail.json()
    assert detail["slug"] == "alpha-org"
    assert detail["member_count"] == 2
    assert len(detail["members"]) == 2
    member_emails = {member["email"] for member in detail["members"]}
    assert "one@example.com" in member_emails
    assert "two@example.com" in member_emails


def test_admin_orgs_membership_auditing(admin_client):
    create_user(user_id="org-target", email="target@example.com", full_name="Target User")
    organization = create_organization(slug="gamma-org", name="Gamma Org")

    resp_add = admin_client.post(
        f"/v1/admin/orgs/{organization.id}/members",
        json={"user_id": "org-target"},
    )
    assert resp_add.status_code == 200
    add_payload = resp_add.json()
    assert add_payload["member_count"] == 1
    assert any(member["id"] == "org-target" for member in add_payload["members"])

    resp_remove = admin_client.delete(
        f"/v1/admin/orgs/{organization.id}/members/org-target"
    )
    assert resp_remove.status_code == 200
    remove_payload = resp_remove.json()
    assert remove_payload["member_count"] == 0
    assert all(member["id"] != "org-target" for member in remove_payload["members"])

    from app.db import get_session
    from app.models import AuditLog

    with next(get_session()) as session:
        membership_logs = session.exec(
            select(AuditLog)
            .where(
                AuditLog.entity_type == "organization_membership",
                AuditLog.entity_id == f"{organization.id}:org-target",
            )
            .order_by(AuditLog.created_at.asc())
        ).all()
        assert [entry.action for entry in membership_logs] == [
            "add_member",
            "remove_member",
        ]
        assert membership_logs[0].details["organization_id"] == organization.id
        assert membership_logs[0].details["user_id"] == "org-target"

        organization_logs = session.exec(
            select(AuditLog)
            .where(
                AuditLog.entity_type == "organization",
                AuditLog.entity_id == organization.id,
                AuditLog.action.in_(["member_added", "member_removed"]),
            )
            .order_by(AuditLog.created_at.asc())
        ).all()
        assert {entry.action for entry in organization_logs} == {
            "member_added",
            "member_removed",
        }


def test_admin_orgs_require_admin_privileges(monkeypatch):
    from app.auth.oidc import get_current_user
    from app.db import init_db
    from app.main import create_app

    init_db()
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "plain-user", "groups": []}
    client = TestClient(app)
    try:
        resp_list = client.get("/v1/admin/orgs")
        assert resp_list.status_code == 403

        organization = create_organization(slug="delta-org", name="Delta Org")
        create_user(user_id="delta-user", email="delta@example.com")

        resp_add = client.post(
            f"/v1/admin/orgs/{organization.id}/members",
            json={"user_id": "delta-user"},
        )
        assert resp_add.status_code == 403
    finally:
        app.dependency_overrides.clear()
        client.close()
