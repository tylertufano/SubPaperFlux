from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def _env(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.setenv("DEV_NO_AUTH", "1")
    monkeypatch.setenv("USER_MGMT_OIDC_ONLY", "1")
    from app.config import is_user_mgmt_core_enabled, is_user_mgmt_oidc_only

    is_user_mgmt_core_enabled.cache_clear()
    is_user_mgmt_oidc_only.cache_clear()
    yield
    is_user_mgmt_core_enabled.cache_clear()
    is_user_mgmt_oidc_only.cache_clear()


def test_oidc_only_mode_requires_oidc_identity(_env):
    from app.db import init_db
    from app.main import create_app

    init_db()
    app = create_app()

    with TestClient(app) as client:
        response = client.get("/v1/feeds")
    assert response.status_code == 401
