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


def test_has_permission_denies_anonymous(session):
    from app.auth.permissions import (
        PERMISSION_MANAGE_BOOKMARKS,
        has_permission,
    )

    assert (
        has_permission(session, None, PERMISSION_MANAGE_BOOKMARKS, owner_id="someone")
        is False
    )


def test_has_permission_allows_owner(session):
    from app.auth.permissions import (
        PERMISSION_MANAGE_BOOKMARKS,
        has_permission,
    )

    current_user = {"sub": "user-1"}
    assert (
        has_permission(session, current_user, PERMISSION_MANAGE_BOOKMARKS, owner_id="user-1")
        is True
    )


def test_has_permission_requires_permission_for_global(session):
    from app.auth.permissions import (
        PERMISSION_MANAGE_BOOKMARKS,
        has_permission,
    )

    current_user = {"sub": "user-2"}
    assert (
        has_permission(session, current_user, PERMISSION_MANAGE_BOOKMARKS, owner_id=None)
        is False
    )


def test_has_permission_respects_role_matrix(session, monkeypatch):
    from app.auth import ensure_role, grant_role
    from app.auth.permissions import (
        PERMISSION_MANAGE_BOOKMARKS,
        PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
        ROLE_PERMISSIONS,
        has_permission,
    )
    from app.models import User

    user = User(id="user-manager", email="manager@example.com")
    session.add(user)
    session.commit()

    monkeypatch.setitem(
        ROLE_PERMISSIONS,
        "manager",
        frozenset({PERMISSION_MANAGE_BOOKMARKS}),
    )
    ensure_role(session, "manager", description="Manager role")
    grant_role(session, user.id, "manager")
    session.commit()

    current_user = {"sub": user.id}
    assert (
        has_permission(
            session,
            current_user,
            PERMISSION_MANAGE_BOOKMARKS,
            owner_id="another-user",
        )
        is True
    )
    assert (
        has_permission(session, current_user, PERMISSION_MANAGE_BOOKMARKS, owner_id=None)
        is True
    )
    assert (
        has_permission(
            session,
            current_user,
            PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
            owner_id=None,
        )
        is False
    )


def test_has_permission_grants_admin_role(session):
    from app.auth import ADMIN_ROLE_NAME, ensure_admin_role, grant_role
    from app.auth.permissions import (
        PERMISSION_MANAGE_BOOKMARKS,
        PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
        has_permission,
    )
    from app.models import User

    user = User(id="admin-user", email="admin@example.com")
    session.add(user)
    session.commit()

    ensure_admin_role(session)
    grant_role(session, user.id, ADMIN_ROLE_NAME)
    session.commit()

    current_user = {"sub": user.id}
    assert (
        has_permission(session, current_user, PERMISSION_MANAGE_GLOBAL_CREDENTIALS, None)
        is True
    )
    assert (
        has_permission(session, current_user, PERMISSION_MANAGE_BOOKMARKS, owner_id="other")
        is True
    )


def test_has_permission_accepts_user_model(session, monkeypatch):
    from app.auth import ensure_role, grant_role
    from app.auth.permissions import (
        PERMISSION_MANAGE_BOOKMARKS,
        ROLE_PERMISSIONS,
        has_permission,
    )
    from app.models import User

    user = User(id="user-model", email="model@example.com")
    session.add(user)
    session.commit()

    monkeypatch.setitem(
        ROLE_PERMISSIONS,
        "manager",
        frozenset({PERMISSION_MANAGE_BOOKMARKS}),
    )
    ensure_role(session, "manager", description="Manager role")
    grant_role(session, user.id, "manager")
    session.commit()

    assert (
        has_permission(session, user, PERMISSION_MANAGE_BOOKMARKS, owner_id="other")
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
