from typing import Any, Dict

import subpaperflux


class _DummyResponse:
    def __init__(self):
        self.status_code = 200


class _RecordingSession:
    def __init__(self):
        self.calls: Dict[str, Any] = {}

    def request(self, method: str, endpoint: str, **kwargs: Any) -> _DummyResponse:
        self.calls = {"method": method, "endpoint": endpoint, "kwargs": kwargs}
        return _DummyResponse()


def test_execute_api_step_uses_form_payload_for_urlencoded_headers():
    session = _RecordingSession()
    step_config = {
        "endpoint": "https://example.com/login",
        "method": "POST",
        "headers": {"Content-Type": "application/x-www-form-urlencoded"},
        "body": {"username": "{{ username }}", "password": "{{ password }}"},
    }
    context = {"username": "alice", "password": "secret"}

    response = subpaperflux._execute_api_step(
        session, step_config, context, "cfg", "login"
    )

    assert isinstance(response, _DummyResponse)
    assert session.calls["kwargs"].get("data") == {
        "username": "alice",
        "password": "secret",
    }
    assert "json" not in session.calls["kwargs"]


def test_execute_api_step_defaults_to_json_when_not_urlencoded():
    session = _RecordingSession()
    step_config = {
        "endpoint": "https://example.com/login",
        "method": "POST",
        "headers": {"Content-Type": "application/json"},
        "body": {"username": "{{ username }}", "password": "{{ password }}"},
    }
    context = {"username": "alice", "password": "secret"}

    response = subpaperflux._execute_api_step(
        session, step_config, context, "cfg", "login"
    )

    assert isinstance(response, _DummyResponse)
    assert session.calls["kwargs"].get("json") == {
        "username": "alice",
        "password": "secret",
    }
    assert "data" not in session.calls["kwargs"]
