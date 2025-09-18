from __future__ import annotations

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
    monkeypatch.delenv("USER_MGMT_ENFORCE", raising=False)

    from app.config import is_user_mgmt_core_enabled, is_user_mgmt_enforce_enabled

    is_user_mgmt_core_enabled.cache_clear()
    is_user_mgmt_enforce_enabled.cache_clear()
    try:
        yield
    finally:
        is_user_mgmt_core_enabled.cache_clear()
        is_user_mgmt_enforce_enabled.cache_clear()


@pytest.fixture()
def client():
    from app.auth import ensure_admin_role
    from app.auth.oidc import get_current_user
    from app.db import get_session, init_db
    from app.main import create_app
    from app.models import Feed, User

    init_db()
    identity = {"sub": "primary", "email": "primary@example.com", "groups": []}

    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: identity
    test_client = TestClient(app)

    with next(get_session()) as session:
        ensure_admin_role(session)
        session.commit()

        primary = session.get(User, identity["sub"])
        if primary is None:
            primary = User(
                id=identity["sub"],
                email=identity.get("email"),
                full_name="Primary User",
                claims={"groups": identity.get("groups", [])},
            )
            session.add(primary)
            session.commit()

        other = session.get(User, "other-1")
        if other is None:
            other = User(id="other-1", email="other@example.com", full_name="Other User")
            session.add(other)
            session.commit()

        if session.exec(select(Feed).where(Feed.owner_user_id == primary.id)).first() is None:
            session.add(
                Feed(
                    url="https://example.com/feed-primary.xml",
                    poll_frequency="1h",
                    owner_user_id=primary.id,
                )
            )

        if session.exec(select(Feed).where(Feed.owner_user_id == other.id)).first() is None:
            session.add(
                Feed(
                    url="https://example.com/feed-other.xml",
                    poll_frequency="1h",
                    owner_user_id=other.id,
                )
            )

        session.commit()

    try:
        yield test_client
    finally:
        app.dependency_overrides.clear()


def test_list_feeds_defaults_to_current_user(client):
    resp = client.get("/v1/feeds")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["total"] == 1
    assert payload["items"]
    assert all(item["owner_user_id"] == "primary" for item in payload["items"])


def test_requesting_other_owner_without_enforcement_returns_empty(client):
    resp = client.get("/v1/feeds", params={"owner_user_ids": "other-1"})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["total"] == 0
    assert payload["items"] == []


def test_enforced_request_for_unauthorized_owner_is_forbidden(monkeypatch, client):
    monkeypatch.setenv("USER_MGMT_ENFORCE", "1")
    from app.config import is_user_mgmt_enforce_enabled

    is_user_mgmt_enforce_enabled.cache_clear()
    client.app.state.cache_user_mgmt_flags()

    try:
        resp = client.get("/v1/feeds", params={"owner_user_ids": "other-1"})
        assert resp.status_code == 403

        resp_multi = client.get(
            "/v1/feeds",
            params=[("owner_user_ids", "primary"), ("owner_user_ids", "other-1")],
        )
        assert resp_multi.status_code == 403
    finally:
        is_user_mgmt_enforce_enabled.cache_clear()


def test_enforced_request_for_authorized_owner_succeeds(monkeypatch, client):
    monkeypatch.setenv("USER_MGMT_ENFORCE", "1")
    from app.auth import ADMIN_ROLE_NAME, grant_role
    from app.config import is_user_mgmt_enforce_enabled
    from app.db import get_session

    is_user_mgmt_enforce_enabled.cache_clear()
    client.app.state.cache_user_mgmt_flags()

    with next(get_session()) as session:
        grant_role(session, "primary", ADMIN_ROLE_NAME, granted_by_user_id="primary")
        session.commit()

    try:
        resp = client.get(
            "/v1/feeds",
            params=[("owner_user_ids", "primary"), ("owner_user_ids", "other-1")],
        )
        assert resp.status_code == 200
        payload = resp.json()
        assert payload["total"] == 2
        owners = {item["owner_user_id"] for item in payload["items"]}
        assert owners == {"primary", "other-1"}
    finally:
        is_user_mgmt_enforce_enabled.cache_clear()
