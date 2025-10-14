import os
import base64
import json
import time
from uuid import uuid4

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


def test_tag_and_folder_catalog_endpoints():
    from app.db import init_db
    from app.main import create_app
    from app.auth.oidc import get_current_user

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u1"}

    client = TestClient(app)

    # Tag catalog CRUD
    create_tag = client.post("/v1/bookmarks/tags", json={"name": "Work"})
    assert create_tag.status_code == 201
    tag_payload = create_tag.json()
    assert tag_payload["bookmark_count"] == 0

    tag_id = tag_payload["id"]

    list_tags = client.get("/v1/bookmarks/tags")
    assert list_tags.status_code == 200
    assert any(item["id"] == tag_id for item in list_tags.json())

    update_tag = client.put(f"/v1/bookmarks/tags/{tag_id}", json={"name": "Work+"})
    assert update_tag.status_code == 200
    assert update_tag.json()["name"] == "Work+"

    delete_tag = client.delete(f"/v1/bookmarks/tags/{tag_id}")
    assert delete_tag.status_code == 204

    assert all(item["id"] != tag_id for item in client.get("/v1/bookmarks/tags").json())

    # Folder catalog CRUD
    create_folder = client.post(
        "/v1/bookmarks/folders",
        json={"name": "Read Later", "instapaper_folder_id": "123"},
    )
    assert create_folder.status_code == 201
    folder_payload = create_folder.json()
    assert folder_payload["bookmark_count"] == 0

    folder_id = folder_payload["id"]

    list_folders = client.get("/v1/bookmarks/folders")
    assert list_folders.status_code == 200
    assert any(item["id"] == folder_id for item in list_folders.json())

    update_folder = client.put(
        f"/v1/bookmarks/folders/{folder_id}",
        json={"name": "Read Now"},
    )
    assert update_folder.status_code == 200
    assert update_folder.json()["name"] == "Read Now"

    delete_folder = client.delete(f"/v1/bookmarks/folders/{folder_id}")
    assert delete_folder.status_code == 204

    assert all(item["id"] != folder_id for item in client.get("/v1/bookmarks/folders").json())


def test_delete_tag_cleans_publish_references():
    from app.db import init_db, get_session
    from app.main import create_app
    from app.auth.oidc import get_current_user
    from app.models import Feed, FeedTagLink, Job, JobSchedule, Tag

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u1"}

    with next(get_session()) as session:
        feed = Feed(owner_user_id="u1", url="https://example.com/rss.xml", poll_frequency="1h")
        session.add(feed)
        session.commit()
        session.refresh(feed)

        keep_tag = Tag(owner_user_id="u1", name="Keep")
        personal_tag = Tag(owner_user_id="u1", name="Personal")
        global_tag = Tag(owner_user_id=None, name="Global")
        session.add(keep_tag)
        session.add(personal_tag)
        session.add(global_tag)
        session.commit()
        session.refresh(keep_tag)
        session.refresh(personal_tag)
        session.refresh(global_tag)

        session.add(FeedTagLink(feed_id=feed.id, tag_id=personal_tag.id, position=0))
        session.commit()

        personal_schedule = JobSchedule(
            schedule_name="personal-publish",
            job_type="publish",
            payload={"tags": [personal_tag.id, keep_tag.id]},
            frequency="1h",
            owner_user_id="u1",
        )
        global_schedule = JobSchedule(
            schedule_name="global-publish",
            job_type="publish",
            payload={"tags": [global_tag.id]},
            frequency="1h",
            owner_user_id=None,
        )
        session.add(personal_schedule)
        session.add(global_schedule)
        session.commit()
        session.refresh(personal_schedule)
        session.refresh(global_schedule)

        personal_job = Job(type="publish", payload={"tags": [personal_tag.id]}, owner_user_id="u1")
        global_job = Job(type="publish", payload={"tags": [global_tag.id]}, owner_user_id=None)
        session.add(personal_job)
        session.add(global_job)
        session.commit()
        session.refresh(personal_job)
        session.refresh(global_job)

        personal_tag_id = personal_tag.id
        keep_tag_id = keep_tag.id
        global_tag_id = global_tag.id
        personal_schedule_id = personal_schedule.id
        global_schedule_id = global_schedule.id
        personal_job_id = personal_job.id
        global_job_id = global_job.id

    client = TestClient(app)

    delete_personal = client.delete(f"/v1/bookmarks/tags/{personal_tag_id}")
    assert delete_personal.status_code == 204

    with next(get_session()) as session:
        assert (
            session.exec(select(FeedTagLink).where(FeedTagLink.tag_id == personal_tag_id)).first()
            is None
        )
        refreshed_schedule = session.get(JobSchedule, personal_schedule_id)
        assert refreshed_schedule is not None
        assert refreshed_schedule.payload.get("tags") == [keep_tag_id]

        refreshed_job = session.get(Job, personal_job_id)
        assert refreshed_job is not None
        assert refreshed_job.payload.get("tags") == []

        untouched_schedule = session.get(JobSchedule, global_schedule_id)
        assert untouched_schedule is not None
        assert untouched_schedule.payload.get("tags") == [global_tag_id]

    delete_global = client.delete(f"/v1/bookmarks/tags/{global_tag_id}")
    assert delete_global.status_code == 204

    with next(get_session()) as session:
        refreshed_schedule = session.get(JobSchedule, global_schedule_id)
        assert refreshed_schedule is not None
        assert refreshed_schedule.payload.get("tags") == []

        refreshed_job = session.get(Job, global_job_id)
        assert refreshed_job is not None
        assert refreshed_job.payload.get("tags") == []


def test_delete_folder_clears_publish_overrides():
    from app.db import init_db, get_session
    from app.main import create_app
    from app.auth.oidc import get_current_user
    from app.models import Feed, Folder, Job, JobSchedule

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u1"}

    with next(get_session()) as session:
        feed = Feed(owner_user_id="u1", url="https://example.com/rss.xml", poll_frequency="1h")
        session.add(feed)
        session.commit()
        session.refresh(feed)

        personal_folder = Folder(owner_user_id="u1", name="Personal")
        global_folder = Folder(owner_user_id=None, name="Global")
        session.add(personal_folder)
        session.add(global_folder)
        session.commit()
        session.refresh(personal_folder)
        session.refresh(global_folder)

        feed.folder_id = personal_folder.id
        session.add(feed)
        session.commit()

        personal_schedule = JobSchedule(
            schedule_name="personal-folder",
            job_type="publish",
            payload={"folder_id": personal_folder.id},
            frequency="1h",
            owner_user_id="u1",
        )
        global_schedule = JobSchedule(
            schedule_name="global-folder",
            job_type="publish",
            payload={"folder_id": global_folder.id},
            frequency="1h",
            owner_user_id=None,
        )
        session.add(personal_schedule)
        session.add(global_schedule)
        session.commit()
        session.refresh(personal_schedule)
        session.refresh(global_schedule)

        personal_job = Job(type="publish", payload={"folder_id": personal_folder.id}, owner_user_id="u1")
        global_job = Job(type="publish", payload={"folder_id": global_folder.id}, owner_user_id=None)
        session.add(personal_job)
        session.add(global_job)
        session.commit()
        session.refresh(personal_job)
        session.refresh(global_job)

        feed_id = feed.id
        personal_folder_id = personal_folder.id
        global_folder_id = global_folder.id
        personal_schedule_id = personal_schedule.id
        global_schedule_id = global_schedule.id
        personal_job_id = personal_job.id
        global_job_id = global_job.id

    client = TestClient(app)

    delete_personal = client.delete(f"/v1/bookmarks/folders/{personal_folder_id}")
    assert delete_personal.status_code == 204

    with next(get_session()) as session:
        refreshed_feed = session.get(Feed, feed_id)
        assert refreshed_feed is not None
        assert refreshed_feed.folder_id is None

        refreshed_schedule = session.get(JobSchedule, personal_schedule_id)
        assert refreshed_schedule is not None
        assert "folder_id" not in refreshed_schedule.payload

        refreshed_job = session.get(Job, personal_job_id)
        assert refreshed_job is not None
        assert "folder_id" not in refreshed_job.payload

        untouched_schedule = session.get(JobSchedule, global_schedule_id)
        assert untouched_schedule is not None
        assert untouched_schedule.payload.get("folder_id") == global_folder_id

    delete_global = client.delete(f"/v1/bookmarks/folders/{global_folder_id}")
    assert delete_global.status_code == 204

    with next(get_session()) as session:
        refreshed_schedule = session.get(JobSchedule, global_schedule_id)
        assert refreshed_schedule is not None
        assert "folder_id" not in refreshed_schedule.payload

        refreshed_job = session.get(Job, global_job_id)
        assert refreshed_job is not None
        assert "folder_id" not in refreshed_job.payload

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


def test_bookmark_preview_sanitizes_html():
    from app.db import init_db, get_session
    from app.main import create_app
    from app.models import Bookmark
    from app.auth.oidc import get_current_user

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

    with next(get_session()) as session:
        bm = Bookmark(
            owner_user_id="u1",
            instapaper_bookmark_id="100",
            title="Gamma",
            url="https://example.com/article",
            content_location="https://example.com/content",
            raw_html_content=sample_html,
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


def test_bookmark_preview_handles_empty_html_content():
    from app.db import init_db, get_session
    from app.main import create_app
    from app.models import Bookmark
    from app.auth.oidc import get_current_user

    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u10"}

    with next(get_session()) as session:
        bm = Bookmark(
            owner_user_id="u10",
            instapaper_bookmark_id="334",
            raw_html_content="",
        )
        session.add(bm)
        session.commit()
        bookmark_id = bm.id

    client = TestClient(app)
    resp = client.get(f"/v1/bookmarks/{bookmark_id}/preview")
    assert resp.status_code == 404
