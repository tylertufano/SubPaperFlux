from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import select


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))


@pytest.fixture()
def user_client():
    from app.db import get_session, init_db
    from app.main import create_app
    from app.auth.oidc import get_current_user
    from app.models import User

    init_db()
    with next(get_session()) as session:
        user = User(id="token-user", email="token@example.com", full_name="Token User")
        session.add(user)
        session.commit()

    app = create_app()
    identity = {
        "sub": "token-user",
        "email": "token@example.com",
        "name": "Token User",
        "groups": [],
    }
    app.dependency_overrides[get_current_user] = lambda: identity
    client = TestClient(app)
    try:
        yield client
    finally:
        app.dependency_overrides.clear()


def test_me_tokens_crud_flow(user_client):
    from app.db import get_session
    from app.models import AuditLog

    create_resp = user_client.post(
        "/v1/me/tokens",
        json={
            "name": "Primary",
            "description": "Main token",
            "scopes": ["bookmarks:read", "jobs:enqueue", "bookmarks:read"],
        },
    )
    assert create_resp.status_code == 201
    created = create_resp.json()
    assert created["name"] == "Primary"
    assert created["token"]
    token_id = created["id"]

    list_resp = user_client.get("/v1/me/tokens")
    assert list_resp.status_code == 200
    page = list_resp.json()
    assert page["total"] == 1
    assert page["items"][0]["name"] == "Primary"
    assert "token" not in page["items"][0]

    detail_resp = user_client.get(f"/v1/me/tokens/{token_id}")
    assert detail_resp.status_code == 200
    assert detail_resp.json()["id"] == token_id

    missing_resp = user_client.get("/v1/me/tokens/not-found")
    assert missing_resp.status_code == 404

    delete_resp = user_client.delete(f"/v1/me/tokens/{token_id}")
    assert delete_resp.status_code == 204

    after_resp = user_client.get("/v1/me/tokens")
    assert after_resp.status_code == 200
    assert after_resp.json()["total"] == 0

    revoked_resp = user_client.get("/v1/me/tokens", params={"include_revoked": "true"})
    assert revoked_resp.status_code == 200
    assert revoked_resp.json()["total"] == 1
    assert revoked_resp.json()["items"][0]["revoked_at"] is not None

    with next(get_session()) as session:
        audit_rows = session.exec(
            select(AuditLog).where(AuditLog.entity_type == "api_token").order_by(AuditLog.created_at)
        ).all()
        actions = [row.action for row in audit_rows]
        assert actions[:2] == ["create", "revoke"]


def test_me_tokens_validations(user_client):
    now = datetime.now(timezone.utc)

    first = user_client.post("/v1/me/tokens", json={"name": "Primary"})
    assert first.status_code == 201

    duplicate = user_client.post("/v1/me/tokens", json={"name": "Primary"})
    assert duplicate.status_code == 400

    expired = user_client.post(
        "/v1/me/tokens",
        json={"name": "Expired", "expires_at": (now - timedelta(minutes=5)).isoformat()},
    )
    assert expired.status_code == 400

    future = user_client.post(
        "/v1/me/tokens",
        json={"name": "Future", "expires_at": (now + timedelta(hours=1)).isoformat()},
    )
    assert future.status_code == 201
