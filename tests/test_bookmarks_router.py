import os
import base64
import os
import pytest
from datetime import datetime
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    # In-memory SQLite
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
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
        session.add(bm)
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
