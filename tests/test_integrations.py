import base64
import json
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth.oidc import get_current_user
from app.db import get_session, init_db
from app.main import create_app
from app.models import Credential
from app.routers.integrations import INSTAPAPER_FOLDERS_LIST_URL


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("CREDENTIALS_ENC_KEY", base64.urlsafe_b64encode(os.urandom(32)).decode())
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "instapaper_app_creds.json").write_text(
        json.dumps({"consumer_key": "ck", "consumer_secret": "cs"})
    )
    monkeypatch.setenv("SPF_CONFIG_DIR", str(config_dir))
    yield


def _create_app_with_instapaper_cred():
    app = create_app()
    init_db()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "user-1", "groups": []}
    with next(get_session()) as session:
        cred = Credential(
            owner_user_id="user-1",
            kind="instapaper",
            data={"oauth_token": "tok", "oauth_token_secret": "sec"},
        )
        session.add(cred)
        session.commit()
        session.refresh(cred)
        cred_id = cred.id
    return app, cred_id


def test_instapaper_test_endpoint_uses_file_when_no_app(monkeypatch):
    app, cred_id = _create_app_with_instapaper_cred()

    class DummyResponse:
        ok = True
        status_code = 200

    def fake_post(self, url, timeout):  # noqa: ANN001
        assert url == INSTAPAPER_FOLDERS_LIST_URL
        client = self.auth.client
        assert client.client_key == "ck"
        assert client.client_secret == "cs"
        assert client.resource_owner_key == "tok"
        assert client.resource_owner_secret == "sec"
        return DummyResponse()

    monkeypatch.setattr("requests_oauthlib.OAuth1Session.post", fake_post)

    client = TestClient(app)
    resp = client.post("/v1/integrations/instapaper/test", json={"credential_id": cred_id})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "status": 200}
