from __future__ import annotations

from pathlib import Path
from typing import Dict

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))


def _make_identity() -> Dict[str, object]:
    return {
        "sub": "oidc-user",
        "email": "user@example.com",
        "name": "OIDC User",
        "picture": "https://example.com/avatar.png",
        "claims": {"groups": ["staff"]},
    }


def _setup_app(monkeypatch, identity: Dict[str, object]) -> TestClient:
    from app.db import init_db
    from app.main import create_app

    init_db()
    monkeypatch.setattr("app.auth.oidc.resolve_user_from_token", lambda token: identity)
    monkeypatch.setattr("app.main.resolve_user_from_token", lambda token: identity)
    app = create_app()
    return TestClient(app)


def test_auto_provision_creates_user_and_role(monkeypatch):
    from app.auth import get_user_roles
    from app.db import get_session
    from app.models import User

    identity = _make_identity()
    monkeypatch.setenv("OIDC_AUTO_PROVISION_USERS", "1")
    monkeypatch.setenv("OIDC_AUTO_PROVISION_DEFAULT_ROLE", "member")

    client = _setup_app(monkeypatch, identity)
    with client:
        resp = client.get("/v1/feeds", headers={"Authorization": "Bearer test"})
        assert resp.status_code == 200

    with next(get_session()) as session:
        user = session.get(User, identity["sub"])
        assert user is not None
        assert user.email == identity["email"]
        assert user.full_name == identity["name"]
        assert user.claims == identity["claims"]
        assert user.last_login_at is not None
        assert "member" in get_user_roles(session, user.id)


def test_auto_provision_disabled(monkeypatch):
    from app.db import get_session
    from app.models import User

    identity = _make_identity()
    monkeypatch.delenv("OIDC_AUTO_PROVISION_USERS", raising=False)
    monkeypatch.delenv("OIDC_AUTO_PROVISION_DEFAULT_ROLE", raising=False)

    client = _setup_app(monkeypatch, identity)
    with client:
        resp = client.get("/v1/feeds", headers={"Authorization": "Bearer test"})
        assert resp.status_code == 200

    with next(get_session()) as session:
        assert session.get(User, identity["sub"]) is None
