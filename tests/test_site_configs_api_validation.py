from __future__ import annotations

from typing import Any, Dict, List, Optional

import pytest

from app.models import SiteConfig, SiteLoginType
from app.routers import site_configs_v1


class _DummyResponse:
    def __init__(self, status_code: int, body: Optional[Dict[str, Any]] = None):
        self.status_code = status_code
        self._body = body

    def json(self) -> Dict[str, Any]:
        if self._body is None:
            raise ValueError("response has no JSON body")
        return self._body


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.setenv("USER_MGMT_CORE", "0")
    yield


def _build_site_config(**overrides: Any) -> SiteConfig:
    payload: Dict[str, Any] = {
        "id": "sc-test",
        "name": "Test Config",
        "site_url": "https://example.com/login",
        "owner_user_id": "user-1",
        "login_type": SiteLoginType.API,
        "api_config": {
            "endpoint": "https://example.com/api/login",
            "method": "POST",
            "pre_login": [
                {"endpoint": "https://example.com/api/pre", "method": "GET"},
            ],
            "cookies_to_store": ["sessionid"],
            "cookies": {"csrftoken": "$.csrf"},
        },
        "required_cookies": ["sessionid", "csrftoken"],
    }
    payload.update(overrides)
    return SiteConfig(**payload)


def test_test_api_site_config_success(monkeypatch):
    calls: List[str] = []

    def _fake_execute(session, step_config, context, config_name, step_name):
        calls.append(step_name)
        if step_name.startswith("pre_login"):
            session.cookies.set("pre_session", "1")
            return _DummyResponse(204, {})
        session.cookies.set("sessionid", "abc123")
        return _DummyResponse(200, {"csrf": "token-123"})

    monkeypatch.setattr(site_configs_v1, "_execute_api_step", _fake_execute)

    config = _build_site_config()

    result = site_configs_v1._test_api_site_config(config)

    assert result["ok"] is True
    assert result["login_type"] == "api"
    assert result["status"] == 200
    context = result["context"]
    assert [step["name"] for step in context["steps"]] == ["pre_login[0]", "login"]
    assert context["cookies"]["missing_expected"] == []
    assert context["cookies"]["missing_required"] == []
    assert context["resolved_cookie_map"]["csrftoken"]["value"] == "token-123"
    assert "login" in calls


def test_test_api_site_config_missing_cookies(monkeypatch):
    def _fake_execute(session, step_config, context, config_name, step_name):
        return _DummyResponse(200, {"csrf": "token-123"})

    monkeypatch.setattr(site_configs_v1, "_execute_api_step", _fake_execute)

    config = _build_site_config()

    result = site_configs_v1._test_api_site_config(config)

    assert result["ok"] is False
    assert "missing" in result["error"]
    cookies = result["context"]["cookies"]
    assert "sessionid" in cookies["missing_expected"]
    assert "sessionid" in cookies["missing_required"]
