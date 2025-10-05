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
    monkeypatch.setenv("USER_MGMT_ENFORCE", "0")

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


def test_feed_folder_and_tags_persist_in_order(client):
    from app.db import get_session
    from app.models import Feed, FeedTagLink, Folder, Tag

    with next(get_session()) as session:
        folder = Folder(name="Primary Folder", owner_user_id="primary")
        updated_folder = Folder(name="Updated Folder", owner_user_id="primary")
        tag_a = Tag(name="Tag Alpha", owner_user_id="primary")
        tag_b = Tag(name="Tag Beta", owner_user_id="primary")
        tag_c = Tag(name="Tag Gamma", owner_user_id="primary")
        session.add_all([folder, updated_folder, tag_a, tag_b, tag_c])
        folder_id = folder.id
        updated_folder_id = updated_folder.id
        tag_a_id = tag_a.id
        tag_b_id = tag_b.id
        tag_c_id = tag_c.id
        session.commit()

    create_resp = client.post(
            "/v1/feeds",
            json={
                "url": "https://example.com/ordered.xml",
                "poll_frequency": "1h",
                "folder_id": folder_id,
                "tag_ids": [tag_b_id, tag_a_id],
            },
        )
    assert create_resp.status_code == 201
    created = create_resp.json()
    assert created["folder_id"] == folder_id
    assert created["tag_ids"] == [tag_b_id, tag_a_id]

    feed_id = created["id"]

    with next(get_session()) as session:
        links = session.exec(
            select(FeedTagLink)
            .where(FeedTagLink.feed_id == feed_id)
            .order_by(FeedTagLink.position)
        ).all()
        assert [link.tag_id for link in links] == [tag_b_id, tag_a_id]

    update_resp = client.put(
        f"/v1/feeds/{feed_id}",
        json={
            "url": "https://example.com/ordered.xml",
            "poll_frequency": "1h",
            "initial_lookback_period": None,
            "is_paywalled": False,
            "rss_requires_auth": False,
            "site_config_id": None,
            "owner_user_id": "primary",
            "site_login_credential_id": None,
            "folder_id": updated_folder_id,
            "tag_ids": [tag_c_id, tag_a_id],
        },
    )
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert updated["folder_id"] == updated_folder_id
    assert updated["tag_ids"] == [tag_c_id, tag_a_id]

    with next(get_session()) as session:
        feed = session.get(Feed, feed_id)
        assert feed is not None
        assert feed.folder_id == updated_folder_id
        links = session.exec(
            select(FeedTagLink)
            .where(FeedTagLink.feed_id == feed_id)
            .order_by(FeedTagLink.position)
        ).all()
        assert [link.tag_id for link in links] == [tag_c_id, tag_a_id]
