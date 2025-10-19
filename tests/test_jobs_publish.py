import base64
import json
import os
from datetime import datetime, timezone, timedelta

import pytest
from sqlmodel import select

from app.models import Bookmark, Feed, FeedTagLink, Folder, Job, JobSchedule, Tag


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
    assert sorted(published_calls, key=lambda item: item[1]) == [
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


def test_handle_publish_publishes_across_all_feeds_when_unscoped(monkeypatch):
    from app.db import get_session, init_db
    from app.jobs import publish as publish_module

    init_db()

    base = datetime(2024, 1, 1, tzinfo=timezone.utc)

    with next(get_session()) as session:
        feed_a = Feed(
            owner_user_id="user-1",
            url="https://example.com/rss-a.xml",
            poll_frequency="1h",
        )
        feed_b = Feed(
            owner_user_id="user-1",
            url="https://example.com/rss-b.xml",
            poll_frequency="1h",
        )
        session.add(feed_a)
        session.add(feed_b)
        session.commit()
        session.refresh(feed_a)
        session.refresh(feed_b)

        def add_bookmark(feed_id: str, slug: str, created_offset: int, ingested_offset: int):
            created = (base + timedelta(hours=created_offset)).isoformat()
            ingested = (base + timedelta(hours=ingested_offset)).isoformat()
            bookmark = Bookmark(
                owner_user_id="user-1",
                url=f"https://example.com/{slug}",
                title=slug.replace("-", " ").title(),
                feed_id=feed_id,
                rss_entry={"ingested_at": ingested},
                publication_flags={
                    "instapaper": {
                        "should_publish": True,
                        "credential_id": "",
                        "created_at": created,
                        "last_seen_at": created,
                    }
                },
                publication_statuses={"instapaper": {"status": "pending"}},
            )
            session.add(bookmark)
            session.flush()
            session.refresh(bookmark)
            return bookmark

        a_one = add_bookmark(feed_a.id, "a-one", 0, 0)
        b_one = add_bookmark(feed_b.id, "b-one", 0, 2)
        a_two = add_bookmark(feed_a.id, "a-two", 1, 1)
        session.commit()

    published_calls: list[str] = []

    def fake_publish(instapaper_id: str, url: str, **kwargs):
        published_calls.append(url)
        return {
            "bookmark_id": f"ip-{url.rsplit('/', 1)[-1]}",
            "content_location": f"https://instapaper.example/{url.rsplit('/', 1)[-1]}",
        }

    monkeypatch.setattr(publish_module, "publish_url", fake_publish)

    result = publish_module.handle_publish(
        job_id="job-all",
        owner_user_id="user-1",
        payload={"instapaper_id": "insta-1"},
    )

    assert result["attempted"] == 3
    assert result["failed"] == []
    assert result["remaining"] == 0
    assert published_calls == [
        "https://example.com/a-one",
        "https://example.com/b-one",
        "https://example.com/a-two",
    ]

    with next(get_session()) as session:
        rows = session.exec(select(Bookmark).order_by(Bookmark.url)).all()
        assert all(
            (row.publication_statuses or {}).get("instapaper", {}).get("status")
            == "published"
            for row in rows
        )


def test_handle_publish_scopes_to_requested_feed(monkeypatch):
    from app.db import get_session, init_db
    from app.jobs import publish as publish_module

    init_db()

    base = datetime(2024, 1, 1, tzinfo=timezone.utc)

    with next(get_session()) as session:
        feed_a = Feed(
            owner_user_id="user-1",
            url="https://example.com/rss-a.xml",
            poll_frequency="1h",
        )
        feed_b = Feed(
            owner_user_id="user-1",
            url="https://example.com/rss-b.xml",
            poll_frequency="1h",
        )
        session.add(feed_a)
        session.add(feed_b)
        session.commit()
        session.refresh(feed_a)
        session.refresh(feed_b)

        def add_bookmark(feed_id: str, slug: str):
            created = base.isoformat()
            bookmark = Bookmark(
                owner_user_id="user-1",
                url=f"https://example.com/{slug}",
                title=slug.replace("-", " ").title(),
                feed_id=feed_id,
                rss_entry={"ingested_at": created},
                publication_flags={
                    "instapaper": {
                        "should_publish": True,
                        "credential_id": "",
                        "created_at": created,
                        "last_seen_at": created,
                    }
                },
                publication_statuses={"instapaper": {"status": "pending"}},
            )
            session.add(bookmark)
            session.flush()
            session.refresh(bookmark)
            return bookmark

        a_one = add_bookmark(feed_a.id, "a-one")
        b_one = add_bookmark(feed_b.id, "b-one")
        session.commit()

        a_one_id = a_one.id
        b_one_id = b_one.id
        feed_a_id = feed_a.id

    published_calls: list[str] = []

    def fake_publish(instapaper_id: str, url: str, **kwargs):
        published_calls.append(url)
        return {
            "bookmark_id": f"ip-{url.rsplit('/', 1)[-1]}",
            "content_location": f"https://instapaper.example/{url.rsplit('/', 1)[-1]}",
        }

    monkeypatch.setattr(publish_module, "publish_url", fake_publish)

    result = publish_module.handle_publish(
        job_id="job-feed-a",
        owner_user_id="user-1",
        payload={"instapaper_id": "insta-1", "feed_id": feed_a_id},
    )

    assert result["attempted"] == 1
    assert result["failed"] == []
    assert result["remaining"] == 0
    assert published_calls == ["https://example.com/a-one"]

    with next(get_session()) as session:
        bookmark_a = session.get(Bookmark, a_one_id)
        assert bookmark_a is not None
        status_a = (bookmark_a.publication_statuses or {}).get("instapaper", {})
        assert status_a.get("status") == "published"

        bookmark_b = session.get(Bookmark, b_one_id)
        assert bookmark_b is not None
        status_b = (bookmark_b.publication_statuses or {}).get("instapaper", {})
        assert status_b.get("status") == "pending"

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


def test_handle_publish_combines_feed_and_schedule_tags(monkeypatch):
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

        tag_feed_a = Tag(owner_user_id="user-1", name="FeedAlpha")
        tag_feed_b = Tag(owner_user_id="user-1", name="FeedBeta")
        tag_schedule = Tag(owner_user_id="user-1", name="ScheduleTag")
        session.add(tag_feed_a)
        session.add(tag_feed_b)
        session.add(tag_schedule)
        session.commit()

        session.add(FeedTagLink(feed_id=feed.id, tag_id=tag_feed_a.id, position=0))
        session.add(FeedTagLink(feed_id=feed.id, tag_id=tag_feed_b.id, position=1))

        feed_folder = Folder(
            owner_user_id="user-1",
            name="Feed Folder",
            instapaper_folder_id="feed-remote",
        )
        schedule_folder = Folder(owner_user_id="user-1", name="Schedule Folder")
        session.add(feed_folder)
        session.add(schedule_folder)
        session.commit()
        session.refresh(feed_folder)
        session.refresh(schedule_folder)

        feed.folder_id = feed_folder.id
        session.add(feed)

        schedule = JobSchedule(
            schedule_name="publish-schedule",
            job_type="publish",
            payload={
                "instapaper_id": "insta-1",
                "feed_id": feed.id,
                "tags": [tag_schedule.id, tag_feed_a.id],
                "folder_id": schedule_folder.id,
            },
            frequency="1h",
            owner_user_id="user-1",
        )
        session.add(schedule)
        session.commit()
        session.refresh(schedule)

        job = Job(
            id="job-1",
            type="publish",
            payload=dict(schedule.payload or {}),
            status="queued",
            owner_user_id="user-1",
            details={"schedule_id": schedule.id},
        )
        session.add(job)
        session.commit()

        _create_pending_bookmarks(session, feed.id, credential_id="insta-1")

        feed_folder_id = feed_folder.id
        schedule_folder_id = schedule_folder.id
        schedule_folder_name = schedule_folder.name

    publish_calls = []

    def fake_publish(instapaper_id: str, url: str, **kwargs):
        publish_calls.append(kwargs)
        return {"bookmark_id": f"ip-{url.rsplit('/', 1)[-1]}"}

    sync_calls = []

    def fake_sync(session, **kwargs):
        sync_calls.append(kwargs)
        return {schedule_folder_id: "sched-remote", feed_folder_id: "feed-remote"}

    monkeypatch.setattr(publish_module, "publish_url", fake_publish)
    monkeypatch.setattr(publish_module, "sync_instapaper_folders", fake_sync)

    result = publish_module.handle_publish(
        job_id="job-1",
        owner_user_id="user-1",
        payload={"instapaper_id": "insta-1", "feed_id": feed.id},
    )

    assert result["attempted"] == 2
    assert len(sync_calls) == 1
    assert publish_calls
    for call_kwargs in publish_calls:
        assert call_kwargs.get("tags") == ["FeedAlpha", "FeedBeta", "ScheduleTag"]
        assert call_kwargs.get("folder") == schedule_folder_name
        assert call_kwargs.get("folder_id") == "sched-remote"


def test_handle_publish_after_rss_poll_without_credentials(monkeypatch, tmp_path):
    from app.db import get_session, init_db
    from app.jobs import publish as publish_module
    from app.jobs.util_subpaperflux import poll_rss_and_publish

    init_db()

    config_dir = tmp_path
    (config_dir / "instapaper_app_creds.json").write_text(json.dumps({}))
    (config_dir / "credentials.json").write_text(json.dumps({}))
    monkeypatch.setenv("SPF_CONFIG_DIR", str(config_dir))

    published_dt = datetime(2024, 1, 1, tzinfo=timezone.utc)

    class FakeSpf:
        @staticmethod
        def get_new_rss_entries(**kwargs):  # type: ignore[override]
            return [
                {
                    "url": "https://example.com/four",
                    "title": "Four",
                    "raw_html_content": "<html><body>Four</body></html>",
                    "published_dt": published_dt,
                    "instapaper_config": {},
                    "app_creds": {},
                    "rss_entry_metadata": {
                        "id": "entry-4",
                        "feed": {"title": "Example Feed"},
                    },
                }
            ]

    monkeypatch.setattr(
        "app.services.subpaperflux_rss.get_new_rss_entries",
        FakeSpf.get_new_rss_entries,
    )

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

    res = poll_rss_and_publish(
        feed_id=feed_id,
        owner_user_id="user-1",
    )

    assert res == {"stored": 1, "duplicates": 0, "total": 1}

    with next(get_session()) as session:
        bookmark = session.exec(select(Bookmark)).one()
        flags = (bookmark.publication_flags or {}).get("instapaper") or {}
        assert flags.get("should_publish") is True
        assert "credential_id" not in flags or not flags.get("credential_id")

    published_calls: list[tuple[str, str]] = []

    def fake_publish(instapaper_id: str, url: str, **kwargs):
        published_calls.append((instapaper_id, url))
        return {
            "bookmark_id": f"ip-{url.rsplit('/', 1)[-1]}",
            "content_location": f"https://instapaper.example/{url.rsplit('/', 1)[-1]}",
        }

    monkeypatch.setattr(publish_module, "publish_url", fake_publish)

    result = publish_module.handle_publish(
        job_id="job-credless",
        owner_user_id="user-1",
        payload={"instapaper_id": "insta-1", "feed_id": feed_id},
    )

    assert result["attempted"] == 1
    assert len(result["published"]) == 1
    assert result["failed"] == []
    assert result["remaining"] == 0
    assert published_calls == [("insta-1", "https://example.com/four")]

    with next(get_session()) as session:
        bookmark = session.exec(select(Bookmark)).one()
        status = bookmark.publication_statuses.get("instapaper") or {}
        assert status.get("status") == "published"
        flags = bookmark.publication_flags.get("instapaper") or {}
        assert flags.get("credential_id") == "insta-1"

