import base64
import os
from pathlib import Path

import pytest
from sqlmodel import Session


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.setenv(
        "CREDENTIALS_ENC_KEY", base64.urlsafe_b64encode(os.urandom(32)).decode()
    )
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))


@pytest.fixture()
def session():
    from app.db import get_engine, init_db

    init_db()
    engine = get_engine()
    with Session(engine) as session:
        yield session


@pytest.fixture()
def make_user(session):
    from app.models import User

    def _factory(user_id: str, email: str | None = None) -> User:
        user = User(id=user_id, email=email or f"{user_id}@example.com")
        session.add(user)
        session.commit()
        session.refresh(user)
        return user

    return _factory


def test_has_permission_denies_anonymous(session):
    from app.auth.permissions import (
        PERMISSION_MANAGE_BOOKMARKS,
        has_permission,
    )

    assert (
        has_permission(session, None, PERMISSION_MANAGE_BOOKMARKS, owner_id="someone")
        is False
    )


def test_permission_matrix_for_owner_and_role_assignments(session, make_user, monkeypatch):
    from app.auth import ensure_role, grant_role
    from app.auth.permissions import (
        PERMISSION_MANAGE_BOOKMARKS,
        ROLE_PERMISSIONS,
        has_permission,
    )

    owner = make_user("user-owner")
    other = make_user("user-other")

    monkeypatch.setitem(
        ROLE_PERMISSIONS,
        "bookmark-manager",
        frozenset({PERMISSION_MANAGE_BOOKMARKS}),
    )
    ensure_role(session, "bookmark-manager", description="Manage team bookmarks")
    session.commit()

    current_user = {"sub": owner.id}

    # Owner access always succeeds, even without explicit role assignments.
    assert (
        has_permission(
            session,
            current_user,
            PERMISSION_MANAGE_BOOKMARKS,
            owner_id=owner.id,
        )
        is True
    )

    # Non-owner / global scopes are denied until a role assignment is granted.
    assert (
        has_permission(
            session,
            current_user,
            PERMISSION_MANAGE_BOOKMARKS,
            owner_id=other.id,
        )
        is False
    )
    assert (
        has_permission(
            session,
            current_user,
            PERMISSION_MANAGE_BOOKMARKS,
            owner_id=None,
        )
        is False
    )

    # Grant the seeded role and verify non-owner/global access now succeeds.
    grant_role(session, owner.id, "bookmark-manager")
    session.commit()

    assert (
        has_permission(
            session,
            current_user,
            PERMISSION_MANAGE_BOOKMARKS,
            owner_id=other.id,
        )
        is True
    )
    assert (
        has_permission(
            session,
            current_user,
            PERMISSION_MANAGE_BOOKMARKS,
            owner_id=None,
        )
        is True
    )


def test_has_permission_rejects_global_without_role(session, make_user):
    from app.auth.permissions import (
        PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
        has_permission,
    )

    user = make_user("user-unassigned")

    assert (
        has_permission(
            session,
            {"sub": user.id},
            PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
            owner_id=None,
        )
        is False
    )


def test_admin_bypasses_scope_requirements(session, make_user):
    from app.auth import ADMIN_ROLE_NAME, ensure_admin_role, grant_role
    from app.auth.permissions import (
        PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
        has_permission,
    )

    admin = make_user("user-admin")

    ensure_admin_role(session)
    session.commit()
    grant_role(session, admin.id, ADMIN_ROLE_NAME)
    session.commit()

    assert (
        has_permission(
            session,
            {"sub": admin.id},
            PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
            owner_id=None,
        )
        is True
    )
    assert (
        has_permission(
            session,
            {"sub": admin.id},
            PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
            owner_id="someone-else",
        )
        is True
    )


def test_has_permission_accepts_user_model(session, make_user, monkeypatch):
    from app.auth import ensure_role, grant_role
    from app.auth.permissions import (
        PERMISSION_MANAGE_BOOKMARKS,
        ROLE_PERMISSIONS,
        has_permission,
    )

    user = make_user("user-model")

    monkeypatch.setitem(
        ROLE_PERMISSIONS,
        "bookmark-manager",
        frozenset({PERMISSION_MANAGE_BOOKMARKS}),
    )
    ensure_role(session, "bookmark-manager", description="Manage team bookmarks")
    session.commit()
    grant_role(session, user.id, "bookmark-manager")
    session.commit()

    assert (
        has_permission(
            session,
            user,
            PERMISSION_MANAGE_BOOKMARKS,
            owner_id="other",
        )
        is True
    )


def test_has_permission_supports_id_dict_key(session):
    from app.auth.permissions import (
        PERMISSION_MANAGE_BOOKMARKS,
        has_permission,
    )

    current_user = {"id": "user-3"}
    assert (
        has_permission(session, current_user, PERMISSION_MANAGE_BOOKMARKS, owner_id="user-3")
        is True
    )
