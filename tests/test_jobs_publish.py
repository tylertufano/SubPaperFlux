import base64
import os
from datetime import datetime, timezone

import pytest
from sqlmodel import select

from app.models import Bookmark, Feed


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.setenv(
        "CREDENTIALS_ENC_KEY",
        base64.urlsafe_b64encode(os.urandom(32)).decode(),
    )
    yield


def _create_pending_bookmarks(session, feed_id: str, *, credential_id: str):
    now = datetime.now(timezone.utc)
    seen = now.isoformat()
    base_flags = {
        "should_publish": True,
        "credential_id": credential_id,
        "created_at": seen,
        "last_seen_at": seen,
    }

    def pending_flags():
        return {"instapaper": dict(base_flags)}

    def pending_status():
        return {"instapaper": {"status": "pending"}}
    first = Bookmark(
        owner_user_id="user-1",
        url="https://example.com/one",
        title="One",
        feed_id=feed_id,
        rss_entry={"ingested_at": seen},
        publication_flags=pending_flags(),
        publication_statuses=pending_status(),
    )
    second = Bookmark(
        owner_user_id="user-1",
        url="https://example.com/two",
        title="Two",
        feed_id=feed_id,
        rss_entry={"ingested_at": seen},
        publication_flags=pending_flags(),
        publication_statuses=pending_status(),
        raw_html_content="<html><body>Two</body></html>",
    )
    already_published = Bookmark(
        owner_user_id="user-1",
        url="https://example.com/three",
        title="Three",
        feed_id=feed_id,
        rss_entry={"ingested_at": seen},
        publication_flags=pending_flags(),
        publication_statuses={
            "instapaper": {
                "status": "published",
                "bookmark_id": "existing-3",
                "published_at": seen,
            }
        },
        instapaper_bookmark_id="existing-3",
        published_at=now,
    )
    session.add(first)
    session.add(second)
    session.add(already_published)
    session.commit()
    session.refresh(first)
    session.refresh(second)
    session.refresh(already_published)
    return first, second, already_published


def test_handle_publish_publishes_pending_bookmarks(monkeypatch):
    from app.db import get_session, init_db
    from app.jobs import publish as publish_module

    init_db()

    with next(get_session()) as session:
        feed = Feed(
            owner_user_id="user-1",
            url="https://example.com/rss.xml",
            poll_frequency="1h",
        )
        session.add(feed)
        session.commit()
        session.refresh(feed)
        feed_id = feed.id
        first, second, _ = _create_pending_bookmarks(
            session, feed_id, credential_id="insta-1"
        )

    published_calls: list[tuple[str, str]] = []

    def fake_publish(instapaper_id: str, url: str, **kwargs):
        published_calls.append((instapaper_id, url))
        return {
            "bookmark_id": f"ip-{url.rsplit('/', 1)[-1]}",
            "content_location": f"https://instapaper.example/{url.rsplit('/', 1)[-1]}",
        }

    monkeypatch.setattr(publish_module, "publish_url", fake_publish)

    result = publish_module.handle_publish(
        job_id="job-1",
        owner_user_id="user-1",
        payload={"instapaper_id": "insta-1", "feed_id": feed_id},
    )

    assert result["attempted"] == 2
    assert len(result["published"]) == 2
    assert result["failed"] == []
    assert result["remaining"] == 0
    assert published_calls == [
        ("insta-1", "https://example.com/one"),
        ("insta-1", "https://example.com/two"),
    ]

    with next(get_session()) as session:
        rows = session.exec(select(Bookmark).order_by(Bookmark.url)).all()
    published_rows = {row.url: row for row in rows}
    assert published_rows["https://example.com/one"].instapaper_bookmark_id.startswith("ip-")
    status_one = published_rows["https://example.com/one"].publication_statuses["instapaper"]
    assert status_one["status"] == "published"
    assert "published_at" in status_one
    flags_one = published_rows["https://example.com/one"].publication_flags["instapaper"]
    assert flags_one["should_publish"] is True
    assert "last_published_at" in flags_one
    assert flags_one["last_publish_job_id"] == "job-1"
    assert published_rows["https://example.com/two"].raw_html_content is not None
    assert published_rows["https://example.com/two"].publication_statuses["instapaper"]["status"] == "published"
    assert published_rows["https://example.com/three"].publication_statuses["instapaper"]["status"] == "published"


def test_handle_publish_handles_failures(monkeypatch):
    from app.db import get_session, init_db
    from app.jobs import publish as publish_module

    init_db()

    with next(get_session()) as session:
        feed = Feed(
            owner_user_id="user-1",
            url="https://example.com/rss.xml",
            poll_frequency="1h",
        )
        session.add(feed)
        session.commit()
        session.refresh(feed)
        feed_id = feed.id
        first, _, _ = _create_pending_bookmarks(
            session, feed_id, credential_id="insta-1"
        )

    def fake_publish(instapaper_id: str, url: str, **kwargs):
        raise RuntimeError("instapaper unavailable")

    monkeypatch.setattr(publish_module, "publish_url", fake_publish)

    result = publish_module.handle_publish(
        job_id="job-err",
        owner_user_id="user-1",
        payload={"instapaper_id": "insta-1", "feed_id": feed_id, "limit": 1},
    )

    assert result["attempted"] == 1
    assert result["published"] == []
    assert len(result["failed"]) == 1
    assert result["remaining"] == 2  # both items remain queued for retry

    failed_id = result["failed"][0]["bookmark_id"]

    with next(get_session()) as session:
        bookmark = session.get(Bookmark, failed_id)
        assert bookmark is not None
        status = bookmark.publication_statuses["instapaper"]
        assert status["status"] == "error"
        assert "error_message" in status
        flags = bookmark.publication_flags["instapaper"]
        assert flags.get("last_error_message")


