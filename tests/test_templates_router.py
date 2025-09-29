from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.setenv("USER_MGMT_CORE", "0")
    yield


@pytest.fixture()
def client():
    from app.main import create_app

    app = create_app()
    return TestClient(app)


TEMPLATES_ROOT = Path(__file__).resolve().parents[1] / "templates"


def _read_template(filename: str) -> bytes:
    return (TEMPLATES_ROOT / filename).read_bytes()


def test_list_templates(client: TestClient):
    response = client.get("/v1/templates")
    assert response.status_code == 200

    payload = response.json()
    assert "templates" in payload
    assert "categories" in payload

    templates = {item["id"]: item for item in payload["templates"]}
    assert templates, "Expected at least one template in the response"

    expected = {
        "subpaperflux-config": "subpaperflux.example.ini",
        "credentials-store": "credentials.example.json",
        "site-configs": "site_configs.example.json",
        "instapaper-app": "instapaper_app_creds.example.json",
        "docker-compose-api": "docker-compose.api.example.yml",
        "docker-compose-worker": "docker-compose.example.yml",
    }

    for template_id, filename in expected.items():
        assert template_id in templates
        entry = templates[template_id]
        assert entry["filename"] == filename
        assert entry["download_url"].endswith(f"/{template_id}/download")
        assert entry["size_bytes"] == len(_read_template(filename))
        assert isinstance(entry["categories"], list)
        assert entry["categories"], "Templates should include at least one category"

    categories = {category["id"]: category["label"] for category in payload["categories"]}
    assert categories
    assert categories["configuration"] == "Configuration"
    assert categories["docker"] == "Docker"


def test_download_template(client: TestClient):
    response = client.get("/v1/templates/subpaperflux-config/download")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/octet-stream")
    disposition = response.headers.get("content-disposition", "")
    assert "attachment" in disposition
    assert "subpaperflux.example.ini" in disposition
    assert response.content == _read_template("subpaperflux.example.ini")


def test_download_missing_template(client: TestClient):
    response = client.get("/v1/templates/not-a-template/download")
    assert response.status_code == 404
    payload = response.json()
    assert payload["code"] == "http_error"
    assert payload["message"] == "Template not found"
