import os
import base64
import json
import time

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
        credential = Credential(owner_user_id="u1", kind="instapaper", data={"token": "abc"})
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
    r = client.get("/bookmarks?since=2024-01-15T00:00:00+00:00")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] >= 1
    assert data["items"][0]["instapaper_bookmark_id"] == "2"

    r2 = client.get("/bookmarks?search=alp")
    assert r2.status_code == 200
    assert any(b["title"] == "Alpha" for b in r2.json()["items"])

    r3 = client.get("/bookmarks?title_query=Alp")
    assert r3.status_code == 200
    assert all("Alp" in (b["title"] or "") for b in r3.json()["items"])

    r4 = client.get("/bookmarks?url_query=https://b")
    assert r4.status_code == 200
    assert all(b["url"] == "https://b" for b in r4.json()["items"])

    r5 = client.get("/bookmarks?regex=/Al.*/i")
    assert r5.status_code == 200
    assert any(b["title"] == "Alpha" for b in r5.json()["items"])

    r6 = client.get("/bookmarks?regex=/https:\\/\\/b/&regex_target=url")
    assert r6.status_code == 200
    assert len(r6.json()["items"]) == 1 and r6.json()["items"][0]["title"] == "Beta"

    bad = client.get("/bookmarks?regex=/[unclosed")
    assert bad.status_code == 400


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
    resp = client.post("/bookmarks/tags", json={"name": "Work"})
    assert resp.status_code == 201
    tag_payload = resp.json()
    assert tag_payload["name"] == "Work"
    tag_id = tag_payload["id"]

    resp = client.put(f"/bookmarks/tags/{tag_id}", json={"name": "Work+"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Work+"

    resp = client.put(f"/bookmarks/{bookmark_id}/tags", json={"tags": ["Work+", "Personal"]})
    assert resp.status_code == 200
    returned_tags = resp.json()
    assert [t["name"] for t in returned_tags] == ["Work+", "Personal"]
    personal_id = next(t["id"] for t in returned_tags if t["name"] == "Personal")

    # Tag filter should only return the tagged bookmark
    resp = client.get(f"/bookmarks?tag_id={personal_id}")
    assert resp.status_code == 200
    filtered = resp.json()
    assert filtered["total"] == 1
    assert [item["id"] for item in filtered["items"]] == [bookmark_id]

    resp = client.get(f"/bookmarks/{bookmark_id}/tags")
    assert resp.status_code == 200
    assert sorted(t["name"] for t in resp.json()) == ["Personal", "Work+"]

    resp = client.delete(f"/bookmarks/tags/{personal_id}")
    assert resp.status_code == 204

    resp = client.get(f"/bookmarks/{bookmark_id}/tags")
    assert resp.status_code == 200
    assert [t["name"] for t in resp.json()] == ["Work+"]

    # Folder CRUD + bookmark association
    resp = client.post(
        "/bookmarks/folders",
        json={"name": "Read Later", "instapaper_folder_id": "123"},
    )
    assert resp.status_code == 201
    folder_payload = resp.json()
    assert folder_payload["name"] == "Read Later"
    assert folder_payload["instapaper_folder_id"] == "123"
    folder_id = folder_payload["id"]

    resp = client.put(f"/bookmarks/folders/{folder_id}", json={"name": "Read Now"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Read Now"

    resp = client.put(f"/bookmarks/{bookmark_id}/folder", json={"folder_id": folder_id})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Read Now"

    # Folder filter should only return the assigned bookmark
    resp = client.get(f"/bookmarks?folder_id={folder_id}")
    assert resp.status_code == 200
    folder_filtered = resp.json()
    assert folder_filtered["total"] == 1
    assert [item["id"] for item in folder_filtered["items"]] == [bookmark_id]

    resp = client.get(f"/bookmarks/{bookmark_id}/folder")
    assert resp.status_code == 200
    assert resp.json()["id"] == folder_id

    resp = client.delete(f"/bookmarks/{bookmark_id}/folder")
    assert resp.status_code == 204

    resp = client.get(f"/bookmarks/{bookmark_id}/folder")
    assert resp.status_code == 200
    assert resp.json() is None

    resp = client.put(
        f"/bookmarks/{bookmark_id}/folder",
        json={"folder_name": "Fresh", "instapaper_folder_id": "987"},
    )
    assert resp.status_code == 200
    new_folder = resp.json()
    assert new_folder["name"] == "Fresh"
    assert new_folder["instapaper_folder_id"] == "987"
    new_folder_id = new_folder["id"]

    resp = client.get("/bookmarks/folders")
    assert resp.status_code == 200
    names = [f["name"] for f in resp.json()]
    assert "Fresh" in names

    resp = client.delete(f"/bookmarks/folders/{folder_id}")
    assert resp.status_code == 204

    resp = client.get("/bookmarks/folders")
    assert resp.status_code == 200
    assert all(f["id"] != folder_id for f in resp.json())

    # Cleanup: ensure folder assignment can be removed again
    resp = client.delete(f"/bookmarks/{bookmark_id}/folder")
    assert resp.status_code == 204

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


def test_bulk_publish_stream_success(monkeypatch):
    from app.routers import bookmarks as bookmarks_router

    app, cred_id = _create_app_with_credential()

    published_urls: list[str] = []

    def fake_publish(*, job_id: str, owner_user_id: str | None, payload: dict):
        published_urls.append(payload["url"])
        return {"bookmark_id": f"ip-{payload['url'].rsplit('/', 1)[-1]}"}

    monkeypatch.setattr(bookmarks_router, "handle_publish", fake_publish)

    client = TestClient(app)
    body = {
        "instapaper_cred_id": cred_id,
        "items": [
            {"id": "one", "url": "https://example.com/one", "title": "One"},
            {"id": "two", "url": "https://example.com/two", "title": "Two"},
        ],
    }

    with client.stream("POST", "/bookmarks/bulk-publish", json=body) as response:
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
    assert raw_events[-1]["success"] == 2 and raw_events[-1]["failed"] == 0
    assert published_urls == ["https://example.com/one", "https://example.com/two"]


def test_bulk_publish_stream_failure(monkeypatch):
    from app.routers import bookmarks as bookmarks_router

    app, cred_id = _create_app_with_credential()

    processed: list[str] = []

    def fake_publish(*, job_id: str, owner_user_id: str | None, payload: dict):
        processed.append(payload["url"])
        if payload["url"].endswith("/two"):
            raise RuntimeError("Instapaper rejected the URL")
        return {"bookmark_id": "ok"}

    monkeypatch.setattr(bookmarks_router, "handle_publish", fake_publish)

    client = TestClient(app)
    body = {
        "instapaper_cred_id": cred_id,
        "items": [
            {"id": "one", "url": "https://example.com/one", "title": "One"},
            {"id": "two", "url": "https://example.com/two", "title": "Two"},
        ],
    }

    with client.stream("POST", "/bookmarks/bulk-publish", json=body) as response:
        assert response.status_code == 200
        events = []
        for chunk in response.iter_lines():
            if not chunk:
                continue
            text = chunk.decode() if isinstance(chunk, bytes) else chunk
            events.append(json.loads(text))

    assert any(event["type"] == "item" and event["id"] == "two" and event["status"] == "error" for event in events)
    complete = events[-1]
    assert complete["type"] == "complete"
    assert complete["success"] == 1 and complete["failed"] == 1
    assert processed == ["https://example.com/one", "https://example.com/two"]


def test_bulk_publish_stream_cancellation(monkeypatch):
    from app.routers import bookmarks as bookmarks_router

    app, cred_id = _create_app_with_credential()

    processed: list[str] = []

    def fake_publish(*, job_id: str, owner_user_id: str | None, payload: dict):
        processed.append(payload["url"])
        return {"bookmark_id": payload["url"]}

    monkeypatch.setattr(bookmarks_router, "handle_publish", fake_publish)

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

    with client.stream("POST", "/bookmarks/bulk-publish", json=body) as response:
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
        "<img src=\"data:text/plain;base64,AAAA\" onerror=\"alert(3)\" alt=\"Evil\" />"
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
    resp = client.get(f"/bookmarks/{bookmark_id}/preview")
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
    resp = client.get(f"/bookmarks/{bookmark_id}/preview")
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
    resp = client.get(f"/bookmarks/{bookmark_id}/preview")
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
    resp = client.get(f"/bookmarks/{bookmark_id}/preview")
    assert resp.status_code == 502
