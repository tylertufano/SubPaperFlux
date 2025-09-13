import os
import base64
import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("CREDENTIALS_ENC_KEY", base64.urlsafe_b64encode(os.urandom(32)).decode())


@pytest.fixture()
def client():
    from app.main import create_app
    from app.db import init_db
    from app.auth.oidc import get_current_user
    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u1", "groups": ["admin"]}
    return TestClient(app)


def test_credentials_and_siteconfigs(client):
    # Create a credential (site_login)
    r = client.post("/credentials", json={"kind": "site_login", "data": {"username": "u", "password": "p"}})
    assert r.status_code == 201
    cred = r.json()
    assert cred["kind"] == "site_login"

    # List v1 credentials
    r2 = client.get("/v1/credentials")
    assert r2.status_code == 200
    data = r2.json()
    assert data["total"] >= 1

    # Create a site config
    payload = {
        "name": "Demo",
        "site_url": "https://example.com/login",
        "username_selector": "#u",
        "password_selector": "#p",
        "login_button_selector": "button[type='submit']",
        "cookies_to_store": ["sid"],
    }
    r3 = client.post("/site-configs", json=payload)
    assert r3.status_code == 201
    sc = r3.json()
    assert sc["name"] == "Demo"

    # List v1 site-configs
    r4 = client.get("/v1/site-configs")
    assert r4.status_code == 200
    scs = r4.json()
    assert scs["total"] >= 1


def test_jobs_validation(client):
    # Missing fields
    r = client.post("/v1/jobs/validate", json={"type": "login", "payload": {}})
    assert r.status_code == 200
    assert r.json()["ok"] is False
    # Provide required
    r2 = client.post("/v1/jobs/validate", json={"type": "login", "payload": {"config_dir": ".", "site_config_id": "a", "credential_id": "b"}})
    assert r2.status_code == 200
    assert r2.json()["ok"] is True

