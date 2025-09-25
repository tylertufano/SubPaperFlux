import base64
import os
from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import select


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.setenv(
        "CREDENTIALS_ENC_KEY",
        base64.urlsafe_b64encode(os.urandom(32)).decode(),
    )
    yield


def test_handle_retention_filters_by_feed_and_publication(monkeypatch):
    from app.db import get_session, init_db
    from app.jobs import retention as retention_module
    from app.models import Bookmark, Credential
    from app.security.crypto import encrypt_dict
    from app.util import ratelimit

    init_db()

    now = datetime.now(timezone.utc)
    older = now - timedelta(days=10)
    recent = now - timedelta(days=2)

    with next(get_session()) as session:
        credential = Credential(
            kind="instapaper",
            description="Primary Instapaper",
            data=encrypt_dict(
                {
                    "oauth_token": "tok",
                    "oauth_token_secret": "secret",
                }
            ),
            owner_user_id="user-1",
        )
        session.add(credential)
        session.commit()
        credential_id = credential.id

        eligible = Bookmark(
            owner_user_id="user-1",
            instapaper_bookmark_id="101",
            feed_id="feed-target",
            published_at=older,
            rss_entry={},
            publication_statuses={
                "instapaper": {
                    "status": "published",
                    "credential_id": credential_id,
                    "bookmark_id": "101",
                    "published_at": older.isoformat(),
                }
            },
        )
        recent_match = Bookmark(
            owner_user_id="user-1",
            instapaper_bookmark_id="102",
            feed_id="feed-target",
            published_at=recent,
            rss_entry={},
            publication_statuses={
                "instapaper": {
                    "status": "published",
                    "credential_id": credential_id,
                    "bookmark_id": "102",
                    "published_at": recent.isoformat(),
                }
            },
        )
        other_feed = Bookmark(
            owner_user_id="user-1",
            instapaper_bookmark_id="103",
            feed_id="feed-other",
            published_at=older,
            rss_entry={},
            publication_statuses={
                "instapaper": {
                    "status": "published",
                    "credential_id": credential_id,
                    "bookmark_id": "103",
                    "published_at": older.isoformat(),
                }
            },
        )
        other_credential = Bookmark(
            owner_user_id="user-1",
            instapaper_bookmark_id="104",
            feed_id="feed-target",
            published_at=older,
            rss_entry={},
            publication_statuses={
                "instapaper": {
                    "status": "published",
                    "credential_id": "other-cred",
                    "bookmark_id": "104",
                    "published_at": older.isoformat(),
                }
            },
        )
        missing_publication = Bookmark(
            owner_user_id="user-1",
            instapaper_bookmark_id="105",
            feed_id="feed-target",
            published_at=older,
            rss_entry={},
            publication_statuses={"instapaper": {"status": "archived"}},
        )
        session.add(eligible)
        session.add(recent_match)
        session.add(other_feed)
        session.add(other_credential)
        session.add(missing_publication)
        session.commit()
        eligible_id = eligible.id
        retained_ids = {
            recent_match.id,
            other_feed.id,
            other_credential.id,
            missing_publication.id,
        }

    class DummyResponse:
        def raise_for_status(self):
            return None

    class DummyOAuth:
        def __init__(self):
            self.calls = []

        def post(self, url, data):
            self.calls.append((url, data))
            return DummyResponse()

    dummy_oauth = DummyOAuth()
    monkeypatch.setattr(
        retention_module,
        "get_instapaper_oauth_session_for_id",
        lambda *args, **kwargs: dummy_oauth,
    )
    monkeypatch.setattr(ratelimit.limiter, "wait", lambda key: None)

    result = retention_module.handle_retention(
        job_id="job-1",
        owner_user_id="user-1",
        payload={
            "older_than": "7d",
            "instapaper_credential_id": credential_id,
            "feed_id": "feed-target",
        },
    )

    assert result == {"deleted_count": 1}
    assert dummy_oauth.calls == [
        (
            retention_module.INSTAPAPER_BOOKMARKS_DELETE_URL,
            {"bookmark_id": "101"},
        )
    ]

    with next(get_session()) as session:
        assert session.get(Bookmark, eligible_id) is None
        remaining = session.exec(select(Bookmark)).all()
        remaining_ids = {bookmark.id for bookmark in remaining}
        assert retained_ids <= remaining_ids
