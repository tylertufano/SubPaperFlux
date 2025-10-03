from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import pytest

from sqlmodel import select


def test_poll_rss_stores_pending_bookmarks(tmp_path, monkeypatch):
    from app import db as dbmod
    from app.db import init_db, get_session
    from app.jobs.util_subpaperflux import poll_rss_and_publish
    from app.models import Feed, Bookmark

    original_db_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = "sqlite://"
    dbmod._engine = None
    dbmod._engine_url = None

    try:
        init_db()

        config_dir = tmp_path
        (config_dir / "instapaper_app_creds.json").write_text(json.dumps({}))
        (config_dir / "credentials.json").write_text(json.dumps({}))
        monkeypatch.setenv("SPF_CONFIG_DIR", str(config_dir))

        with next(get_session()) as session:
            feed = Feed(
                owner_user_id="user-rss",
                url="https://example.com/rss.xml",
                poll_frequency="1h",
                is_paywalled=True,
            )
            session.add(feed)
            session.commit()
            session.refresh(feed)
            feed_id = feed.id

        published_dt = datetime(2024, 1, 1, tzinfo=timezone.utc)

        class FakeSpf:
            @staticmethod
            def get_new_rss_entries(**kwargs):  # type: ignore[override]
                return [
                    {
                        "url": "https://example.com/paywalled",
                        "title": "Paywalled Story",
                        "raw_html_content": "<html>full content</html>",
                        "published_dt": published_dt,
                        "instapaper_config": {},
                        "app_creds": {},
                        "rss_entry_metadata": {
                            "id": "entry-1",
                            "feed": {"title": "Example Feed"},
                        },
                    }
                ]

        monkeypatch.setattr("app.jobs.util_subpaperflux._import_spf", lambda: FakeSpf())

        res = poll_rss_and_publish(
            instapaper_id="cred-instapaper",
            feed_id=feed_id,
            owner_user_id="user-rss",
        )

        assert res == {"stored": 1, "duplicates": 0, "total": 1}

        with next(get_session()) as session:
            bookmarks = session.exec(select(Bookmark)).all()
            assert len(bookmarks) == 1
            bookmark = bookmarks[0]
            assert bookmark.instapaper_bookmark_id is None
            assert bookmark.feed_id == feed_id
            assert bookmark.raw_html_content == "<html>full content</html>"
            assert bookmark.publication_statuses.get("instapaper", {}).get("status") == "pending"
            flags = bookmark.publication_flags.get("instapaper", {})
            assert flags.get("should_publish") is True
            assert flags.get("is_paywalled") is True
            assert flags.get("credential_id") == "cred-instapaper"
            assert bookmark.rss_entry.get("id") == "entry-1"
            assert bookmark.rss_entry.get("feed", {}).get("title") == "Example Feed"
    finally:
        if original_db_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = original_db_url
        dbmod._engine = None
        dbmod._engine_url = None


def test_poll_rss_requires_cookies_for_paywalled_feed(tmp_path, monkeypatch):
    from app import db as dbmod
    from app.db import init_db, get_session
    from app.jobs.util_subpaperflux import poll_rss_and_publish
    from app.models import Feed

    original_db_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = "sqlite://"
    dbmod._engine = None
    dbmod._engine_url = None

    try:
        init_db()

        config_dir = tmp_path
        (config_dir / "instapaper_app_creds.json").write_text(json.dumps({}))
        (config_dir / "credentials.json").write_text(json.dumps({}))
        monkeypatch.setenv("SPF_CONFIG_DIR", str(config_dir))

        with next(get_session()) as session:
            feed = Feed(
                owner_user_id="user-rss",
                url="https://example.com/rss.xml",
                poll_frequency="1h",
                is_paywalled=True,
                rss_requires_auth=True,
            )
            session.add(feed)
            session.commit()
            session.refresh(feed)
            feed_id = feed.id

        with pytest.raises(RuntimeError, match="Cannot poll RSS feed"):
            poll_rss_and_publish(
                feed_id=feed_id,
                owner_user_id="user-rss",
            )
    finally:
        if original_db_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = original_db_url
        dbmod._engine = None
        dbmod._engine_url = None


def test_poll_rss_without_instapaper_credentials(tmp_path, monkeypatch):
    from app import db as dbmod
    from app.db import init_db, get_session
    from app.jobs.util_subpaperflux import (
        iter_pending_instapaper_bookmarks,
        poll_rss_and_publish,
    )
    from app.models import Feed, Bookmark

    original_db_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = "sqlite://"
    dbmod._engine = None
    dbmod._engine_url = None

    try:
        init_db()

        config_dir = tmp_path
        (config_dir / "instapaper_app_creds.json").write_text(json.dumps({}))
        (config_dir / "credentials.json").write_text(json.dumps({}))
        monkeypatch.setenv("SPF_CONFIG_DIR", str(config_dir))

        with next(get_session()) as session:
            feed = Feed(
                owner_user_id="user-rss",
                url="https://example.com/rss.xml",
                poll_frequency="1h",
            )
            session.add(feed)
            session.commit()
            session.refresh(feed)
            feed_id = feed.id

        published_dt = datetime(2024, 1, 1, tzinfo=timezone.utc)

        class FakeSpf:
            @staticmethod
            def get_new_rss_entries(**kwargs):  # type: ignore[override]
                return [
                    {
                        "url": "https://example.com/uncategorized",
                        "title": "Uncategorized Story",
                        "raw_html_content": "<html>full content</html>",
                        "published_dt": published_dt,
                        "instapaper_config": {},
                        "app_creds": {},
                        "rss_entry_metadata": {
                            "id": "entry-2",
                            "feed": {"title": "Example Feed"},
                        },
                    }
                ]

        monkeypatch.setattr("app.jobs.util_subpaperflux._import_spf", lambda: FakeSpf())

        res = poll_rss_and_publish(
            feed_id=feed_id,
            owner_user_id="user-rss",
        )

        assert res == {"stored": 1, "duplicates": 0, "total": 1}

        with next(get_session()) as session:
            bookmarks = session.exec(select(Bookmark)).all()
            assert len(bookmarks) == 1
            bookmark = bookmarks[0]
            bookmark_id = bookmark.id
            assert bookmark.instapaper_bookmark_id is None
            assert bookmark.feed_id == feed_id
            statuses = bookmark.publication_statuses or {}
            instapaper_status = statuses.get("instapaper") or {}
            assert instapaper_status.get("status") == "pending"
            assert instapaper_status.get("updated_at")
            flags = (bookmark.publication_flags or {}).get("instapaper") or {}
            assert flags.get("should_publish") is True
            assert flags.get("is_paywalled") is False
            assert flags.get("last_seen_at")
            assert flags.get("has_raw_html") is True
            assert "credential_id" not in flags or flags.get("credential_id") in (None, "")
            assert bookmark.rss_entry.get("id") == "entry-2"

            pending = iter_pending_instapaper_bookmarks(
                session,
                owner_user_id="user-rss",
                instapaper_id="cred-job",
                feed_id=feed_id,
            )
            assert [bm.url for bm in pending] == ["https://example.com/uncategorized"]

        with next(get_session()) as session:
            bookmark = session.get(Bookmark, bookmark_id)
            assert bookmark is not None
            bookmark.publication_flags = {}
            bookmark.publication_statuses = {}
            session.add(bookmark)
            session.commit()

        dup_res = poll_rss_and_publish(
            feed_id=feed_id,
            owner_user_id="user-rss",
        )

        assert dup_res == {"stored": 0, "duplicates": 1, "total": 1}

        with next(get_session()) as session:
            bookmark = session.get(Bookmark, bookmark_id)
            assert bookmark is not None
            statuses = bookmark.publication_statuses or {}
            instapaper_status = statuses.get("instapaper") or {}
            assert instapaper_status.get("status") == "pending"
            flags = (bookmark.publication_flags or {}).get("instapaper") or {}
            assert flags.get("should_publish") is True
            assert flags.get("last_seen_at")
    finally:
        if original_db_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = original_db_url
        dbmod._engine = None
        dbmod._engine_url = None
