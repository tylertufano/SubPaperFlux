from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import pytest
import requests

from sqlmodel import select


def test_get_article_html_with_cookies_attaches_session(monkeypatch):
    import subpaperflux

    class FakeSession:
        def __init__(self):
            self.cookies = requests.cookies.RequestsCookieJar()
            self.headers = {}
            self.seen_cookie_snapshot = {}

        def get(self, url, timeout=30):
            self.seen_cookie_snapshot = requests.utils.dict_from_cookiejar(self.cookies)
            response = requests.Response()
            response.status_code = 200
            response._content = b"<html>hello world</html>"
            response.url = url
            response.encoding = "utf-8"
            return response

    fake_session = FakeSession()
    monkeypatch.setattr("subpaperflux.requests.Session", lambda: fake_session)

    cookies = [
        {"name": "sessionid", "value": "abc123", "domain": "example.com", "path": "/"},
    ]

    html = subpaperflux.get_article_html_with_cookies(
        "https://example.com/articles/paywalled", cookies
    )

    assert html == "<html>hello world</html>"
    assert fake_session.seen_cookie_snapshot.get("sessionid") == "abc123"


def test_get_article_html_with_cookies_detects_login_redirect(monkeypatch):
    import subpaperflux

    class FakeSession:
        def __init__(self):
            self.cookies = requests.cookies.RequestsCookieJar()
            self.headers = {}

        def get(self, url, timeout=30):
            response = requests.Response()
            response.status_code = 200
            response._content = b"<html>Please log in</html>"
            response.url = "https://example.com/login"
            response.encoding = "utf-8"
            return response

    monkeypatch.setattr("subpaperflux.requests.Session", lambda: FakeSession())

    cookies = [{"name": "sessionid", "value": "abc123", "domain": "example.com"}]

    assert (
        subpaperflux.get_article_html_with_cookies(
            "https://example.com/articles/paywalled", cookies
        )
        is None
    )


def test_get_article_html_with_cookies_detects_paywall_copy(monkeypatch):
    import subpaperflux

    class FakeSession:
        def __init__(self):
            self.cookies = requests.cookies.RequestsCookieJar()
            self.headers = {}

        def get(self, url, timeout=30):
            response = requests.Response()
            response.status_code = 200
            response._content = b"<html>This post is for paid subscribers only.</html>"
            response.url = url
            response.encoding = "utf-8"
            return response

    monkeypatch.setattr("subpaperflux.requests.Session", lambda: FakeSession())

    cookies = [{"name": "sessionid", "value": "abc123", "domain": "example.com"}]

    assert (
        subpaperflux.get_article_html_with_cookies(
            "https://example.com/articles/paywalled", cookies
        )
        is None
    )



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


def test_poll_rss_initial_lookback_only_first_run(tmp_path, monkeypatch):
    from app import db as dbmod
    from app.db import init_db, get_session
    from app.jobs.util_subpaperflux import (
        poll_rss_and_publish,
        parse_lookback_to_seconds,
    )
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

        initial_lookback = "48h"

        with next(get_session()) as session:
            feed = Feed(
                owner_user_id="user-rss",
                url="https://example.com/rss.xml",
                poll_frequency="1h",
                initial_lookback_period=initial_lookback,
            )
            session.add(feed)
            session.commit()
            session.refresh(feed)
            feed_id = feed.id

        observed_states = []

        class FakeSpf:
            @staticmethod
            def get_new_rss_entries(**kwargs):  # type: ignore[override]
                observed_states.append(kwargs.get("state"))
                return []

        monkeypatch.setattr("app.jobs.util_subpaperflux._import_spf", lambda: FakeSpf())

        first_res = poll_rss_and_publish(
            feed_id=feed_id,
            owner_user_id="user-rss",
        )

        assert first_res == {"stored": 0, "duplicates": 0, "total": 0}
        assert len(observed_states) == 1

        first_state = observed_states[0]
        assert first_state is not None
        first_cutoff = first_state["last_rss_timestamp"]
        if first_cutoff.tzinfo is None:
            first_cutoff = first_cutoff.replace(tzinfo=timezone.utc)

        with next(get_session()) as session:
            feed = session.get(Feed, feed_id)
            assert feed is not None
            first_poll_at = feed.last_rss_poll_at

        assert first_poll_at is not None
        if first_poll_at.tzinfo is None:
            first_poll_at = first_poll_at.replace(tzinfo=timezone.utc)
        diff_seconds = (first_poll_at - first_cutoff).total_seconds()
        assert diff_seconds == pytest.approx(
            parse_lookback_to_seconds(initial_lookback), abs=0.01
        )

        second_res = poll_rss_and_publish(
            feed_id=feed_id,
            owner_user_id="user-rss",
        )

        assert second_res == {"stored": 0, "duplicates": 0, "total": 0}
        assert len(observed_states) == 2

        second_state = observed_states[1]
        assert second_state is not None
        second_cutoff = second_state["last_rss_timestamp"]
        if second_cutoff.tzinfo is None:
            second_cutoff = second_cutoff.replace(tzinfo=timezone.utc)
        assert second_cutoff == first_poll_at

        with next(get_session()) as session:
            feed = session.get(Feed, feed_id)
            assert feed is not None
            second_poll_at = feed.last_rss_poll_at

        assert second_poll_at is not None
        if second_poll_at.tzinfo is None:
            second_poll_at = second_poll_at.replace(tzinfo=timezone.utc)
        assert second_poll_at >= first_poll_at

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
