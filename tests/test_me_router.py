from pathlib import Path

import pytest
from fastapi.testclient import TestClient


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
        user = User(id="me-user", email="me@example.com", full_name="Me User")
        session.add(user)
        session.commit()

    app = create_app()
    identity = {
        "sub": "me-user",
        "email": "me@example.com",
        "name": "Me User",
        "groups": [],
    }
    app.dependency_overrides[get_current_user] = lambda: identity
    client = TestClient(app)
    try:
        yield client
    finally:
        app.dependency_overrides.clear()


def test_get_me_defaults(user_client):
    response = user_client.get("/v1/me")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == "me-user"
    assert data["locale"] is None
    assert data["notification_preferences"]["email_job_updates"] is True
    assert data["notification_preferences"]["email_digest"] is False


def test_update_me_preferences_round_trip(user_client):
    payload = {
        "locale": "pseudo",
        "notification_preferences": {
            "email_job_updates": False,
            "email_digest": True,
        },
    }
    update = user_client.patch("/v1/me", json=payload)
    assert update.status_code == 200
    updated = update.json()
    assert updated["locale"] == "pseudo"
    assert updated["notification_preferences"]["email_job_updates"] is False
    assert updated["notification_preferences"]["email_digest"] is True

    follow = user_client.get("/v1/me")
    assert follow.status_code == 200
    after = follow.json()
    assert after["locale"] == "pseudo"
    assert after["notification_preferences"]["email_job_updates"] is False
    assert after["notification_preferences"]["email_digest"] is True

    from app.db import get_session
    from app.models import User

    with next(get_session()) as session:
        user = session.get(User, "me-user")
        assert user is not None
        assert user.locale == "pseudo"
        assert user.notification_preferences.get("email_job_updates") is False
        assert user.notification_preferences.get("email_digest") is True


def test_update_me_rejects_unsupported_locale(user_client):
    response = user_client.patch("/v1/me", json={"locale": "fr"})
    assert response.status_code == 400
    payload = response.json()
    assert payload["message"] == "Unsupported locale"

