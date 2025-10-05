import os
import base64
import json
import time
from uuid import uuid4

import httpx
import pytest
from datetime import datetime
from fastapi.testclient import TestClient
from sqlmodel import select


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    # In-memory SQLite
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    # Crypto key for any encryption paths
    monkeypatch.setenv("CREDENTIALS_ENC_KEY", base64.urlsafe_b64encode(os.urandom(32)).decode())


def _create_app_with_credential():
    from app.db import init_db, get_session
    from app.main import create_app
    from app.models import Credential
    from app.auth.oidc import get_current_user

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u1"}

    with next(get_session()) as session:
        credential = Credential(
            owner_user_id="u1",
            kind="instapaper",
            description="Test credential",
            data={"token": "abc"},
        )
        session.add(credential)
        session.commit()
        cred_id = credential.id

    return app, cred_id


def test_bookmarks_list_filters():
    from app.db import init_db, get_session
    from app.main import create_app
    from app.models import Bookmark
    from app.auth.oidc import get_current_user
    app = create_app()
    init_db()

    # Override auth to a static user
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u1"}

    # Seed some bookmarks
    with next(get_session()) as session:
        session.add(Bookmark(owner_user_id="u1", instapaper_bookmark_id="1", title="Alpha", url="https://a", published_at=datetime.fromisoformat("2024-01-01T00:00:00+00:00")))
        session.add(Bookmark(owner_user_id="u1", instapaper_bookmark_id="2", title="Beta", url="https://b", published_at=datetime.fromisoformat("2024-02-01T00:00:00+00:00")))
        session.add(Bookmark(owner_user_id="u2", instapaper_bookmark_id="3", title="Other", url="https://c", published_at=datetime.fromisoformat("2024-03-01T00:00:00+00:00")))
        session.commit()

    client = TestClient(app)
    r = client.get("/v1/bookmarks?since=2024-01-15T00:00:00+00:00")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] >= 1
    assert data["items"][0]["instapaper_bookmark_id"] == "2"

    r2 = client.get("/v1/bookmarks?search=alp")
    assert r2.status_code == 200
    assert any(b["title"] == "Alpha" for b in r2.json()["items"])

    r3 = client.get("/v1/bookmarks?title_query=Alp")
    assert r3.status_code == 200
    assert all("Alp" in (b["title"] or "") for b in r3.json()["items"])

    r4 = client.get("/v1/bookmarks?url_query=https://b")
    assert r4.status_code == 200
    assert all(b["url"] == "https://b" for b in r4.json()["items"])

    r5 = client.get("/v1/bookmarks?regex=/Al.*/i")
    assert r5.status_code == 200
    assert any(b["title"] == "Alpha" for b in r5.json()["items"])

    r6 = client.get("/v1/bookmarks?regex=/https:\\/\\/b/&regex_target=url")
    assert r6.status_code == 200
    assert len(r6.json()["items"]) == 1 and r6.json()["items"][0]["title"] == "Beta"

    bad = client.get("/v1/bookmarks?regex=/[unclosed")
    assert bad.status_code == 400


def test_bookmarks_count_endpoint_available_under_v1_prefix():
    from app.db import init_db, get_session
    from app.main import create_app
    from app.models import Bookmark
    from app.auth.oidc import get_current_user

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "user-count"}

    with next(get_session()) as session:
        session.add(
            Bookmark(
                owner_user_id="user-count",
                instapaper_bookmark_id="count-1",
                title="Count Me In",
                url="https://example.com/one",
            )
        )
        session.add(
            Bookmark(
                owner_user_id="user-count",
                instapaper_bookmark_id="count-2",
                title="Another One",
                url="https://example.com/two",
            )
        )
        session.add(
            Bookmark(
                owner_user_id="other-user",
                instapaper_bookmark_id="count-3",
                title="Should Not Count",
                url="https://example.com/three",
            )
        )
        session.commit()

    client = TestClient(app)

    response = client.get("/v1/bookmarks/count")
    assert response.status_code == 200
    payload = response.json()
    assert payload == {"total": 2, "total_pages": 1}


def test_bookmark_tags_and_folders_endpoints():
    from app.db import init_db, get_session
    from app.main import create_app
    from app.models import Bookmark
    from app.auth.oidc import get_current_user

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u1"}

    with next(get_session()) as session:
        bm = Bookmark(owner_user_id="u1", instapaper_bookmark_id="10", title="Gamma", url="https://gamma")
        _other = Bookmark(owner_user_id="u1", instapaper_bookmark_id="11", title="Delta", url="https://delta")
        session.add(bm)
        session.add(_other)
        session.commit()
        bookmark_id = bm.id

    client = TestClient(app)

    # Tag CRUD + bookmark association
    resp = client.post("/v1/bookmarks/tags", json={"name": "Work"})
    assert resp.status_code == 201
    tag_payload = resp.json()
    assert tag_payload["name"] == "Work"
    tag_id = tag_payload["id"]

    list_resp = client.get("/v1/bookmarks/tags")
    assert list_resp.status_code == 200
    tags_list = list_resp.json()
    assert any(item["id"] == tag_id and item["bookmark_count"] == 0 for item in tags_list)

    resp = client.put(f"/v1/bookmarks/tags/{tag_id}", json={"name": "Work+"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Work+"

    resp = client.put(f"/v1/bookmarks/{bookmark_id}/tags", json={"tags": ["Work+", "Personal"]})
    assert resp.status_code == 200
    returned_tags = resp.json()
    assert [t["name"] for t in returned_tags] == ["Work+", "Personal"]
    personal_id = next(t["id"] for t in returned_tags if t["name"] == "Personal")
    assert all(t["bookmark_count"] == 1 for t in returned_tags)

    # Tag filter should only return the tagged bookmark
    resp = client.get(f"/v1/bookmarks?tag_id={personal_id}")
    assert resp.status_code == 200
    filtered = resp.json()
    assert filtered["total"] == 1
    assert [item["id"] for item in filtered["items"]] == [bookmark_id]

    resp = client.get(f"/v1/bookmarks/{bookmark_id}/tags")
    assert resp.status_code == 200
    bookmark_tags = resp.json()
    assert sorted(t["name"] for t in bookmark_tags) == ["Personal", "Work+"]
    assert all(t["bookmark_count"] == 1 for t in bookmark_tags)

    resp = client.delete(f"/v1/bookmarks/tags/{personal_id}")
    assert resp.status_code == 204

    resp = client.get(f"/v1/bookmarks/{bookmark_id}/tags")
    assert resp.status_code == 200
    updated_tags = resp.json()
    assert [t["name"] for t in updated_tags] == ["Work+"]
    assert updated_tags[0]["bookmark_count"] == 1

    resp = client.get("/v1/bookmarks/tags")
    assert resp.status_code == 200
    remaining_tags = resp.json()
    assert all(t["name"] != "Personal" for t in remaining_tags)
    assert any(t["id"] == tag_id and t["bookmark_count"] == 1 for t in remaining_tags)

    # Folder CRUD + bookmark association
    resp = client.post(
        "/v1/bookmarks/folders",
        json={"name": "Read Later", "instapaper_folder_id": "123"},
    )
    assert resp.status_code == 201
    folder_payload = resp.json()
    assert folder_payload["name"] == "Read Later"
    assert folder_payload["instapaper_folder_id"] == "123"
    folder_id = folder_payload["id"]

    folder_list = client.get("/v1/bookmarks/folders")
    assert folder_list.status_code == 200
    folders_data = folder_list.json()
    assert any(f["id"] == folder_id and f["bookmark_count"] == 0 for f in folders_data)

    resp = client.put(f"/v1/bookmarks/folders/{folder_id}", json={"name": "Read Now"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Read Now"

    resp = client.put(f"/v1/bookmarks/{bookmark_id}/folder", json={"folder_id": folder_id})
    assert resp.status_code == 200
    folder_assignment = resp.json()
    assert folder_assignment["name"] == "Read Now"
    assert folder_assignment["bookmark_count"] == 1

    # Folder filter should only return the assigned bookmark
    resp = client.get(f"/v1/bookmarks?folder_id={folder_id}")
    assert resp.status_code == 200
    folder_filtered = resp.json()
    assert folder_filtered["total"] == 1
    assert [item["id"] for item in folder_filtered["items"]] == [bookmark_id]

    resp = client.get(f"/v1/bookmarks/{bookmark_id}/folder")
    assert resp.status_code == 200
    assert resp.json()["id"] == folder_id

    resp = client.delete(f"/v1/bookmarks/{bookmark_id}/folder")
    assert resp.status_code == 204

    resp = client.get("/v1/bookmarks/folders")
    assert resp.status_code == 200
    cleared_folders = resp.json()
    assert any(f["id"] == folder_id and f["bookmark_count"] == 0 for f in cleared_folders)

    resp = client.get(f"/v1/bookmarks/{bookmark_id}/folder")
    assert resp.status_code == 200
    assert resp.json() is None

    resp = client.put(
        f"/v1/bookmarks/{bookmark_id}/folder",
        json={"folder_name": "Fresh", "instapaper_folder_id": "987"},
    )
    assert resp.status_code == 200
    new_folder = resp.json()
    assert new_folder["name"] == "Fresh"
    assert new_folder["instapaper_folder_id"] == "987"
    new_folder_id = new_folder["id"]
    assert new_folder["bookmark_count"] == 1

    resp = client.get("/v1/bookmarks/folders")
    assert resp.status_code == 200
    names = [f["name"] for f in resp.json()]
    assert "Fresh" in names

    resp = client.delete(f"/v1/bookmarks/folders/{folder_id}")
    assert resp.status_code == 204

    resp = client.get("/v1/bookmarks/folders")
    assert resp.status_code == 200
    assert all(f["id"] != folder_id for f in resp.json())

    # Cleanup: ensure folder assignment can be removed again
    resp = client.delete(f"/v1/bookmarks/{bookmark_id}/folder")
    assert resp.status_code == 204

    resp = client.get("/v1/bookmarks/folders")
    assert resp.status_code == 200
    post_clear = resp.json()
    assert any(f["id"] == new_folder_id and f["bookmark_count"] == 0 for f in post_clear)

    from app.db import get_session
    from app.models import AuditLog

    with next(get_session()) as session:
        logs = session.exec(
            select(AuditLog).where(AuditLog.entity_type == "bookmark").order_by(AuditLog.created_at)
        ).all()
    tag_logs = [log for log in logs if "tags" in log.details]
    assert tag_logs and tag_logs[-1].details.get("tags") == ["Work+", "Personal"]
    assert any(log.details.get("folder_name") == "Read Now" for log in logs if log.details.get("folder_id"))
    assert any(log.details.get("folder_name") == "Fresh" for log in logs if log.details.get("folder_id"))
    assert any(log.details.get("folder_cleared") for log in logs)


def test_bulk_tags_success_and_audit_logging():
    from app.db import init_db, get_session
    from app.main import create_app
    from app.models import AuditLog, Bookmark, BookmarkTagLink
    from app.auth.oidc import get_current_user

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u1"}

    with next(get_session()) as session:
        bm1 = Bookmark(id=str(uuid4()), owner_user_id="u1", instapaper_bookmark_id="100", title="First")
        bm2 = Bookmark(id=str(uuid4()), owner_user_id="u1", instapaper_bookmark_id="101", title="Second")
        session.add(bm1)
        session.add(bm2)
        session.commit()
        bookmark_ids = [bm1.id, bm2.id]

    client = TestClient(app)
    resp = client.post(
        "/v1/bookmarks/bulk-tags",
        json={"bookmark_ids": bookmark_ids, "tags": ["  Work  ", "Focus"], "clear": False},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert [item["bookmark_id"] for item in payload] == bookmark_ids
    assert [tag["name"] for tag in payload[0]["tags"]] == ["Work", "Focus"]
    assert all(tag["bookmark_count"] == 2 for tag in payload[0]["tags"])

    with next(get_session()) as session:
        links = session.exec(select(BookmarkTagLink)).all()
        assert len(links) == 4  # two tags attached to two bookmarks
        logs = session.exec(
            select(AuditLog)
            .where(AuditLog.entity_id.in_(bookmark_ids))
            .order_by(AuditLog.created_at)
        ).all()

    assert len(logs) == 2
    assert all(log.details.get("bulk") for log in logs)
    assert all(log.details.get("clear") is False for log in logs)
    assert all(log.details.get("tags") == ["Work", "Focus"] for log in logs)

    clear_resp = client.post(
        "/v1/bookmarks/bulk-tags",
        json={"bookmark_ids": bookmark_ids, "tags": [], "clear": True},
    )
    assert clear_resp.status_code == 200
    assert all(item["tags"] == [] for item in clear_resp.json())

    with next(get_session()) as session:
        remaining = session.exec(select(BookmarkTagLink)).all()
        assert remaining == []
        clear_logs = session.exec(
            select(AuditLog)
            .where(AuditLog.entity_id.in_(bookmark_ids))
            .order_by(AuditLog.created_at)
        ).all()

    assert len(clear_logs) == 4
    assert all(clear_logs[i].details.get("clear") is True for i in (-1, -2))


def test_bulk_tags_rejects_foreign_bookmarks():
    from app.db import init_db, get_session
    from app.main import create_app
    from app.models import Bookmark
    from app.auth.oidc import get_current_user

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u1"}

    with next(get_session()) as session:
        owned = Bookmark(id=str(uuid4()), owner_user_id="u1", instapaper_bookmark_id="200", title="Owned")
        foreign = Bookmark(id=str(uuid4()), owner_user_id="u2", instapaper_bookmark_id="201", title="Foreign")
        session.add(owned)
        session.add(foreign)
        session.commit()
        owned_id = owned.id
        foreign_id = foreign.id

    client = TestClient(app)
    resp = client.post(
        "/v1/bookmarks/bulk-tags",
        json={
            "bookmark_ids": [owned_id, foreign_id],
            "tags": ["Mixed"],
            "clear": False,
        },
    )
    assert resp.status_code == 403
    body = resp.json()
    assert str(foreign_id) in body["message"]


def test_bulk_tags_validation_errors():
    from app.db import init_db, get_session
    from app.main import create_app
    from app.models import Bookmark
    from app.auth.oidc import get_current_user

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u1"}

    with next(get_session()) as session:
        bookmark = Bookmark(id=str(uuid4()), owner_user_id="u1", instapaper_bookmark_id="300", title="Solo")
        session.add(bookmark)
        session.commit()
        bookmark_id = bookmark.id

    client = TestClient(app)

    resp = client.post(
        "/v1/bookmarks/bulk-tags",
        json={"bookmark_ids": [], "tags": ["One"], "clear": False},
    )
    assert resp.status_code == 422

    resp = client.post(
        "/v1/bookmarks/bulk-tags",
        json={"bookmark_ids": [bookmark_id], "tags": [], "clear": False},
    )
    assert resp.status_code == 400
    assert resp.json()["title"] == "At least one tag is required unless clear is true"

    resp = client.post(
        "/v1/bookmarks/bulk-tags",
        json={"bookmark_ids": [bookmark_id], "tags": ["   "], "clear": False},
    )
    assert resp.status_code == 400
    assert resp.json()["title"] == "Tag names must be non-empty"

    resp = client.post(
        "/v1/bookmarks/bulk-tags",
        json={"bookmark_ids": [bookmark_id], "tags": ["One"], "clear": True},
    )
    assert resp.status_code == 400
    assert resp.json()["title"] == "Cannot provide tags when clear is true"


def test_bulk_folders_assigns_and_syncs_instapaper(monkeypatch):
    from app.db import init_db, get_session
    from app.main import create_app
    from app.models import AuditLog, Bookmark, BookmarkFolderLink, Folder
    from app.auth.oidc import get_current_user
    from app.routers import bookmarks as bookmarks_router

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "folders"}

    with next(get_session()) as session:
        folder = Folder(owner_user_id="folders", name="Inbox")
        bm1 = Bookmark(id=str(uuid4()), owner_user_id="folders", instapaper_bookmark_id="400", title="One")
        bm2 = Bookmark(id=str(uuid4()), owner_user_id="folders", instapaper_bookmark_id="401", title="Two")
        session.add(folder)
        session.add(bm1)
        session.add(bm2)
        session.commit()
        folder_id = folder.id
        bookmark_ids = [bm1.id, bm2.id]

    calls: list[tuple[str, dict[str, str]]] = []

    class DummyResp:
        def raise_for_status(self):
            return None

    class DummyOAuth:
        def post(self, url, data):
            calls.append((url, data))
            return DummyResp()

    monkeypatch.setattr(
        bookmarks_router,
        "get_instapaper_oauth_session",
        lambda user_id: DummyOAuth(),
    )

    client = TestClient(app)
    resp = client.post(
        "/v1/bookmarks/bulk-folders",
        json={
            "bookmark_ids": bookmark_ids,
            "folder_id": folder_id,
            "instapaper_folder_id": "77",
        },
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert [item["bookmark_id"] for item in payload] == bookmark_ids
    assert all(item["folder"]["id"] == folder_id for item in payload)
    assert payload[0]["folder"]["instapaper_folder_id"] == "77"
    assert payload[0]["folder"]["bookmark_count"] == 2

    with next(get_session()) as session:
        links = session.exec(select(BookmarkFolderLink)).all()
        assert {link.bookmark_id for link in links} == set(bookmark_ids)
        folder = session.get(Folder, folder_id)
        assert folder.instapaper_folder_id == "77"
        logs = session.exec(
            select(AuditLog)
            .where(AuditLog.entity_id.in_(bookmark_ids))
            .order_by(AuditLog.created_at)
        ).all()

    assert len(logs) == 2
    assert all(log.details.get("bulk") for log in logs)
    assert all(log.details.get("folder_id") == folder_id for log in logs)
    assert all(log.details.get("instapaper_folder_id") == "77" for log in logs)
    assert [call[0] for call in calls] == [bookmarks_router.INSTAPAPER_BOOKMARKS_MOVE_URL] * 2
    assert [call[1]["bookmark_id"] for call in calls] == ["400", "401"]
    assert all(call[1]["folder_id"] == "77" for call in calls)


def test_bulk_folders_returns_404_for_missing_folder():
    from app.db import init_db, get_session
    from app.main import create_app
    from app.models import Bookmark, Folder
    from app.auth.oidc import get_current_user

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "folders"}

    with next(get_session()) as session:
        folder = Folder(owner_user_id="folders", name="Elsewhere")
        bm = Bookmark(id=str(uuid4()), owner_user_id="folders", instapaper_bookmark_id="410")
        session.add(folder)
        session.add(bm)
        session.commit()
        bookmark_id = bm.id
        folder_id = folder.id
        session.delete(folder)
        session.commit()

    client = TestClient(app)
    resp = client.post(
        "/v1/bookmarks/bulk-folders",
        json={"bookmark_ids": [bookmark_id], "folder_id": folder_id},
    )
    assert resp.status_code == 404
    assert resp.json()["message"] == "Folder not found"


def test_bulk_folders_rejects_foreign_bookmarks():
    from app.db import init_db, get_session
    from app.main import create_app
    from app.models import Bookmark, BookmarkFolderLink, Folder
    from app.auth.oidc import get_current_user

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "folders"}

    with next(get_session()) as session:
        folder = Folder(owner_user_id="folders", name="Team")
        owned = Bookmark(id=str(uuid4()), owner_user_id="folders", instapaper_bookmark_id="420")
        foreign = Bookmark(id=str(uuid4()), owner_user_id="outsider", instapaper_bookmark_id="421")
        session.add(folder)
        session.add(owned)
        session.add(foreign)
        session.commit()
        folder_id = folder.id
        owned_id = owned.id
        foreign_id = foreign.id

    client = TestClient(app)
    resp = client.post(
        "/v1/bookmarks/bulk-folders",
        json={"bookmark_ids": [owned_id, foreign_id], "folder_id": folder_id},
    )
    assert resp.status_code == 403
    body = resp.json()
    assert foreign_id in body["message"]

    with next(get_session()) as session:
        links = session.exec(select(BookmarkFolderLink)).all()
        assert links == []


def test_bulk_folders_audit_entries(monkeypatch):
    from app.db import init_db, get_session
    from app.main import create_app
    from app.models import AuditLog, Bookmark, BookmarkFolderLink, Folder
    from app.auth.oidc import get_current_user
    from app.routers import bookmarks as bookmarks_router

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "audit"}

    with next(get_session()) as session:
        folder_one = Folder(owner_user_id="audit", name="Old", instapaper_folder_id="old")
        folder_two = Folder(owner_user_id="audit", name="New")
        bm = Bookmark(id=str(uuid4()), owner_user_id="audit", instapaper_bookmark_id="500")
        session.add(folder_one)
        session.add(folder_two)
        session.add(bm)
        session.commit()
        session.add(BookmarkFolderLink(bookmark_id=bm.id, folder_id=folder_one.id))
        session.commit()
        bookmark_id = bm.id
        folder_one_id = folder_one.id
        folder_two_id = folder_two.id

    calls: list[tuple[str, dict[str, str]]] = []

    class DummyResp:
        def raise_for_status(self):
            return None

    class DummyOAuth:
        def post(self, url, data):
            calls.append((url, data))
            return DummyResp()

    monkeypatch.setattr(
        bookmarks_router,
        "get_instapaper_oauth_session",
        lambda user_id: DummyOAuth(),
    )

    client = TestClient(app)
    move_resp = client.post(
        "/v1/bookmarks/bulk-folders",
        json={
            "bookmark_ids": [bookmark_id],
            "folder_id": folder_two_id,
            "instapaper_folder_id": "new",
        },
    )
    assert move_resp.status_code == 200
    clear_resp = client.post(
        "/v1/bookmarks/bulk-folders",
        json={"bookmark_ids": [bookmark_id]},
    )
    assert clear_resp.status_code == 200
    assert clear_resp.json()[0]["folder"] is None

    with next(get_session()) as session:
        logs = session.exec(
            select(AuditLog)
            .where(AuditLog.entity_id == bookmark_id)
            .order_by(AuditLog.created_at)
        ).all()

    assert len(logs) >= 2
    move_log = logs[-2]
    clear_log = logs[-1]

    assert move_log.details.get("previous_folder_id") == folder_one_id
    assert move_log.details.get("folder_id") == folder_two_id
    assert move_log.details.get("folder_name") == "New"
    assert move_log.details.get("instapaper_folder_id") == "new"
    assert move_log.details.get("bulk") is True

    assert clear_log.details.get("folder_cleared") is True
    assert clear_log.details.get("previous_folder_id") == folder_two_id
    assert clear_log.details.get("bulk") is True

    assert len(calls) == 1
    assert calls[0][0] == bookmarks_router.INSTAPAPER_BOOKMARKS_MOVE_URL
    assert calls[0][1]["bookmark_id"] == "500"
    assert calls[0][1]["folder_id"] == "new"

def test_bulk_publish_stream_success(monkeypatch):
    from app.routers import bookmarks as bookmarks_router

    app, cred_id = _create_app_with_credential()

    published_urls: list[str] = []

    def fake_publish(instapaper_id: str, url: str, **kwargs):
        published_urls.append(url)
        return {"bookmark_id": f"ip-{url.rsplit('/', 1)[-1]}"}

    monkeypatch.setattr(bookmarks_router, "publish_url", fake_publish)

    client = TestClient(app)
    body = {
        "instapaper_cred_id": cred_id,
        "items": [
            {"id": "one", "url": "https://example.com/one", "title": "One"},
            {"id": "two", "url": "https://example.com/two", "title": "Two"},
        ],
    }

    with client.stream("POST", "/v1/bookmarks/bulk-publish", json=body) as response:
        assert response.status_code == 200
        raw_events = []
        for chunk in response.iter_lines():
            if not chunk:
                continue
            text = chunk.decode() if isinstance(chunk, bytes) else chunk
            raw_events.append(json.loads(text))

    assert [event["type"] for event in raw_events] == [
        "start",
        "item",
        "item",
        "item",
        "item",
        "complete",
    ]
    item_events = [event for event in raw_events if event["type"] == "item"]
    assert any(event["id"] == "one" and event["status"] == "pending" for event in item_events)
    assert any(event["id"] == "one" and event["status"] == "success" for event in item_events)
    assert any(event["id"] == "two" and event["status"] == "pending" for event in item_events)
    assert any(event["id"] == "two" and event["status"] == "success" for event in item_events)
    assert raw_events[-1]["success"] == 2 and raw_events[-1]["failed"] == 0
    assert published_urls == ["https://example.com/one", "https://example.com/two"]


def test_bulk_publish_derives_tags_and_folder(monkeypatch):
    from app.db import get_session
    from app.models import Bookmark, Feed, FeedTagLink, Folder, Tag
    from app.routers import bookmarks as bookmarks_router

    app, cred_id = _create_app_with_credential()

    with next(get_session()) as session:
        feed = Feed(owner_user_id="u1", url="https://example.com/rss.xml", poll_frequency="1h")
        session.add(feed)
        session.commit()
        session.refresh(feed)

        tag_feed_one = Tag(owner_user_id="u1", name="FeedOne")
        tag_feed_two = Tag(owner_user_id="u1", name="FeedTwo")
        tag_extra = Tag(owner_user_id="u1", name="Extra")
        session.add(tag_feed_one)
        session.add(tag_feed_two)
        session.add(tag_extra)
        session.commit()

        session.add(FeedTagLink(feed_id=feed.id, tag_id=tag_feed_one.id, position=0))
        session.add(FeedTagLink(feed_id=feed.id, tag_id=tag_feed_two.id, position=1))

        feed_folder = Folder(owner_user_id="u1", name="Feed Folder", instapaper_folder_id="feed-remote")
        override_folder = Folder(owner_user_id="u1", name="Override Folder")
        session.add(feed_folder)
        session.add(override_folder)
        session.commit()
        session.refresh(override_folder)

        feed.folder_id = feed_folder.id
        session.add(feed)

        bookmark = Bookmark(
            owner_user_id="u1",
            url="https://example.com/item",
            title="Item",
            feed_id=feed.id,
        )
        session.add(bookmark)
        session.commit()
        session.refresh(bookmark)

        override_folder_id = override_folder.id
        tag_extra_id = tag_extra.id
        bookmark_id = bookmark.id
        feed_folder_id = feed_folder.id

    publish_calls = []

    def fake_publish(instapaper_id: str, url: str, **kwargs):
        publish_calls.append(kwargs)
        return {"bookmark_id": "ip-item"}

    sync_calls = []

    def fake_sync(session, **kwargs):
        sync_calls.append(kwargs)
        return {override_folder_id: "remote-override", feed_folder_id: "feed-remote"}

    monkeypatch.setattr(bookmarks_router, "publish_url", fake_publish)
    monkeypatch.setattr(bookmarks_router, "sync_instapaper_folders", fake_sync)

    client = TestClient(app)
    body = {
        "instapaper_cred_id": cred_id,
        "items": [
            {
                "id": "one",
                "bookmark_id": bookmark_id,
                "url": "https://example.com/item",
                "tag_ids": [tag_extra_id],
                "tags": ["Manual"],
                "folder_id": override_folder_id,
            }
        ],
    }

    with client.stream("POST", "/v1/bookmarks/bulk-publish", json=body) as response:
        assert response.status_code == 200
        for chunk in response.iter_lines():
            if not chunk:
                continue
            event = json.loads(chunk if isinstance(chunk, str) else chunk.decode())
            if event.get("type") == "item" and event.get("status") == "failure":
                pytest.fail(f"Unexpected failure event: {event}")

    assert publish_calls
    assert len(sync_calls) == 1
    kwargs = publish_calls[0]
    assert kwargs.get("tags") == ["FeedOne", "FeedTwo", "Extra", "Manual"]
    assert kwargs.get("folder") == "Override Folder"
    assert kwargs.get("folder_id") == "remote-override"


def test_bulk_publish_stream_failure(monkeypatch):
    from app.routers import bookmarks as bookmarks_router

    app, cred_id = _create_app_with_credential()

    processed: list[str] = []

    def fake_publish(instapaper_id: str, url: str, **kwargs):
        processed.append(url)
        if url.endswith("/two"):
            raise RuntimeError("Instapaper rejected the URL")
        return {"bookmark_id": "ok"}

    monkeypatch.setattr(bookmarks_router, "publish_url", fake_publish)

    client = TestClient(app)
    body = {
        "instapaper_cred_id": cred_id,
        "items": [
            {"id": "one", "url": "https://example.com/one", "title": "One"},
            {"id": "two", "url": "https://example.com/two", "title": "Two"},
        ],
    }

    with client.stream("POST", "/v1/bookmarks/bulk-publish", json=body) as response:
        assert response.status_code == 200
        events = []
        for chunk in response.iter_lines():
            if not chunk:
                continue
            text = chunk.decode() if isinstance(chunk, bytes) else chunk
            events.append(json.loads(text))

    assert any(event["type"] == "item" and event["id"] == "two" and event["status"] == "failure" for event in events)
    complete = events[-1]
    assert complete["type"] == "complete"
    assert complete["success"] == 1 and complete["failed"] == 1
    assert processed == ["https://example.com/one", "https://example.com/two"]


def test_bulk_publish_stream_cancellation(monkeypatch):
    from app.routers import bookmarks as bookmarks_router

    app, cred_id = _create_app_with_credential()

    processed: list[str] = []

    def fake_publish(instapaper_id: str, url: str, **kwargs):
        processed.append(url)
        return {"bookmark_id": url}

    monkeypatch.setattr(bookmarks_router, "publish_url", fake_publish)

    call_counter = {"value": 0}

    async def fake_is_disconnected(self):  # type: ignore[override]
        call_counter["value"] += 1
        return call_counter["value"] > 1

    monkeypatch.setattr(bookmarks_router.Request, "is_disconnected", fake_is_disconnected, raising=False)

    client = TestClient(app)
    body = {
        "instapaper_cred_id": cred_id,
        "items": [
            {"id": "one", "url": "https://example.com/one", "title": "One"},
            {"id": "two", "url": "https://example.com/two", "title": "Two"},
        ],
    }

    with client.stream("POST", "/v1/bookmarks/bulk-publish", json=body) as response:
        assert response.status_code == 200
        iterator = response.iter_lines()
        for _ in range(3):
            chunk = next(iterator)
            text = chunk.decode() if isinstance(chunk, bytes) else chunk
            json.loads(text)

    time.sleep(0.05)
    assert processed == ["https://example.com/one"]


def test_bookmark_preview_sanitizes_html(monkeypatch):
    from app.db import init_db, get_session
    from app.main import create_app
    from app.models import Bookmark
    from app.auth.oidc import get_current_user
    from app.routers import bookmarks as bookmarks_router

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u1"}

    sample_html = (
        "<!DOCTYPE html><html><head><style>.noop { color: red; }</style></head>"
        "<body style=\"background:red\"><script>alert('x')</script><div onclick=\"alert(1)\">"
        "<a href=\"javascript:alert(2)\">Click</a>"
        "<a href=\"https://allowed.example/article\" title=\"Safe\">Allowed</a>"
        "<img src=\"data:text/plain;base64,AAAA\" onerror=\"alert(3)\" alt=\"Evil\" />"
        "<img src=\"https://allowed.example/image.jpg\" alt=\"Legit\" />"
        "<p>Content</p></div></body></html>"
    )
    monkeypatch.setattr(bookmarks_router, "_fetch_html", lambda url: sample_html)

    with next(get_session()) as session:
        bm = Bookmark(
            owner_user_id="u1",
            instapaper_bookmark_id="100",
            title="Gamma",
            url="https://example.com/article",
            content_location="https://example.com/content",
        )
        session.add(bm)
        session.commit()
        bookmark_id = bm.id

    client = TestClient(app)
    resp = client.get(f"/v1/bookmarks/{bookmark_id}/preview")
    assert resp.status_code == 200
    body = resp.text
    assert "<script" not in body.lower()
    assert "onclick" not in body.lower()
    assert "onerror" not in body.lower()
    assert "javascript:" not in body.lower()
    assert "data:" not in body.lower()
    assert "<style" not in body.lower()
    assert "style=" not in body.lower()
    assert "<html" not in body.lower()
    assert "<body" not in body.lower()
    assert "Content" in body
    assert "Evil" in body
    assert "https://allowed.example/article" in body
    assert "https://allowed.example/image.jpg" in body
    assert resp.headers["content-type"].startswith("text/html")


def test_bookmark_preview_uses_url_when_content_location_missing(monkeypatch):
    from app.db import init_db, get_session
    from app.main import create_app
    from app.models import Bookmark
    from app.auth.oidc import get_current_user
    from app.routers import bookmarks as bookmarks_router

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u42"}

    calls: list[str] = []

    def fake_fetch(url: str) -> str:
        calls.append(url)
        return "<p>OK</p>"

    monkeypatch.setattr(bookmarks_router, "_fetch_html", fake_fetch)

    with next(get_session()) as session:
        bm = Bookmark(
            owner_user_id="u42",
            instapaper_bookmark_id="105",
            title="Delta",
            url="https://fallback.test/article",
            content_location=None,
        )
        session.add(bm)
        session.commit()
        bookmark_id = bm.id

    client = TestClient(app)
    resp = client.get(f"/v1/bookmarks/{bookmark_id}/preview")
    assert resp.status_code == 200
    assert calls == ["https://fallback.test/article"]
    assert "OK" in resp.text


def test_bookmark_preview_handles_missing_content():
    from app.db import init_db, get_session
    from app.main import create_app
    from app.models import Bookmark
    from app.auth.oidc import get_current_user

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u9"}

    with next(get_session()) as session:
        bm = Bookmark(owner_user_id="u9", instapaper_bookmark_id="333")
        session.add(bm)
        session.commit()
        bookmark_id = bm.id

    client = TestClient(app)
    resp = client.get(f"/v1/bookmarks/{bookmark_id}/preview")
    assert resp.status_code == 404


def test_bookmark_preview_fetch_error(monkeypatch):
    from app.db import init_db, get_session
    from app.main import create_app
    from app.models import Bookmark
    from app.auth.oidc import get_current_user
    from app.routers import bookmarks as bookmarks_router

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "ufail"}

    def fake_fetch(url: str) -> str:
        raise httpx.RequestError("boom", request=httpx.Request("GET", url))

    monkeypatch.setattr(bookmarks_router, "_fetch_html", fake_fetch)

    with next(get_session()) as session:
        bm = Bookmark(
            owner_user_id="ufail",
            instapaper_bookmark_id="404",
            url="https://example.net/article",
        )
        session.add(bm)
        session.commit()
        bookmark_id = bm.id

    client = TestClient(app)
    resp = client.get(f"/v1/bookmarks/{bookmark_id}/preview")
    assert resp.status_code == 502
