import os
import base64
import pytest
from datetime import datetime
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    # In-memory SQLite
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    # Crypto key for any encryption paths
    monkeypatch.setenv("CREDENTIALS_ENC_KEY", base64.urlsafe_b64encode(os.urandom(32)).decode())


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
