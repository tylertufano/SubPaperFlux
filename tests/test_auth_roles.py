import base64
import os
from pathlib import Path

import pytest
from sqlmodel import Session, select


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


def test_ensure_admin_role_idempotent(session):
    from app.auth import ADMIN_ROLE_NAME, ensure_admin_role
    from app.models import Role

    ensure_admin_role(session)
    session.commit()

    ensure_admin_role(session)
    session.commit()

    roles = session.exec(select(Role).where(Role.name == ADMIN_ROLE_NAME)).all()
    assert len(roles) == 1
    assert roles[0].is_system is True
    assert roles[0].description


def test_grant_and_revoke_role(session):
    from app.auth import ensure_role, get_user_roles, grant_role, revoke_role, user_has_role
    from app.models import User, UserRole

    user = User(id="user-1", email="user@example.com")
    session.add(user)
    session.commit()

    ensure_role(session, "editor", description="Can edit resources")
    grant_role(session, user.id, "editor")
    session.commit()

    assert user_has_role(session, user.id, "editor") is True
    assert get_user_roles(session, user.id) == ["editor"]

    # Idempotent assignment should not create duplicates
    grant_role(session, user.id, "editor")
    session.commit()
    assignments = session.exec(
        select(UserRole).where(UserRole.user_id == user.id)
    ).all()
    assert len(assignments) == 1

    assert revoke_role(session, user.id, "editor") is True
    session.commit()
    assert user_has_role(session, user.id, "editor") is False
    assert get_user_roles(session, user.id) == []
    assert revoke_role(session, user.id, "editor") is False


def test_grant_role_validations(session):
    from app.auth import ensure_role, grant_role
    from app.models import User

    user = User(id="user-2", email="user2@example.com")
    session.add(user)
    session.commit()

    with pytest.raises(ValueError):
        grant_role(session, user.id, "missing-role")

    ensure_role(session, "viewer", description="Read only")

    with pytest.raises(ValueError):
        grant_role(session, "not-a-user", "viewer")

    grant_role(session, user.id, "viewer")
    session.commit()
