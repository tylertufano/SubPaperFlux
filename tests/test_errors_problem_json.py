from __future__ import annotations

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import create_app


def _create_test_client() -> TestClient:
    app = create_app()

    @app.get("/trigger-http")
    def trigger_http_error():
        raise HTTPException(status_code=404, detail="Missing resource")

    @app.get("/trigger-validation")
    def trigger_validation_error(item_id: int):  # pragma: no cover - signature triggers validation
        return {"item_id": item_id}

    @app.get("/trigger-unhandled")
    def trigger_unhandled_error():
        raise RuntimeError("boom")

    return TestClient(app, raise_server_exceptions=False)


def _assert_problem_response(response, *, expected_status: int, expected_code: str) -> None:
    assert response.status_code == expected_status
    content_type = response.headers.get("content-type")
    assert content_type is not None
    assert content_type.startswith("application/problem+json")

    trace_id = response.headers.get("X-Trace-Id")
    assert trace_id, "Trace identifier header is missing"

    payload = response.json()
    assert payload["status"] == expected_status
    assert payload["code"] == expected_code
    assert payload["trace_id"] == trace_id
    assert payload["title"] == payload["message"]
    assert payload["type"].endswith(f"#{expected_code}")


def test_http_exception_uses_problem_json() -> None:
    client = _create_test_client()
    response = client.get("/trigger-http")

    _assert_problem_response(response, expected_status=404, expected_code="http_error")


def test_validation_exception_uses_problem_json() -> None:
    client = _create_test_client()
    response = client.get("/trigger-validation", params={"item_id": "not-an-int"})

    _assert_problem_response(response, expected_status=422, expected_code="validation_error")
    payload = response.json()
    assert "details" in payload
    assert isinstance(payload["details"].get("errors"), list)


def test_unhandled_exception_uses_problem_json() -> None:
    client = _create_test_client()
    response = client.get("/trigger-unhandled")

    _assert_problem_response(response, expected_status=500, expected_code="internal_error")
    payload = response.json()
    assert payload["message"] == "An unexpected error occurred"
