from __future__ import annotations

from pathlib import Path
from typing import Dict, Optional

import pytest
from fastapi.testclient import TestClient
from prometheus_client.parser import text_string_to_metric_families


AUTH_HEADER = {"Authorization": "Bearer test"}


def _make_identity() -> Dict[str, object]:
    return {
        "sub": "metrics-user",
        "email": "metrics@example.com",
        "name": "Metrics User",
        "groups": ["admin"],
        "claims": {"groups": ["admin"]},
    }


def _read_metric(
    client: TestClient,
    metric: str,
    labels: Optional[Dict[str, str]] = None,
) -> float:
    response = client.get("/metrics")
    response.raise_for_status()
    text = response.text
    for family in text_string_to_metric_families(text):
        for sample in family.samples:
            if sample.name != metric:
                continue
            sample_labels = dict(sample.labels)
            if labels is None and not sample_labels:
                return float(sample.value)
            if labels is not None and sample_labels == labels:
                return float(sample.value)
    return 0.0


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.setenv("OIDC_AUTO_PROVISION_USERS", "1")
    monkeypatch.setenv("USER_MGMT_CORE", "1")
    from app.config import is_user_mgmt_core_enabled

    is_user_mgmt_core_enabled.cache_clear()


@pytest.fixture
def client(monkeypatch) -> TestClient:
    identity = _make_identity()
    from app.auth import ADMIN_ROLE_NAME, ensure_admin_role, grant_role
    from app.db import get_session, init_db
    from app.main import create_app
    from app.models import User

    init_db()
    monkeypatch.setattr("app.auth.oidc.resolve_user_from_token", lambda token: identity)
    monkeypatch.setattr("app.main.resolve_user_from_token", lambda token: identity)
    app = create_app()
    with TestClient(app) as test_client:
        with next(get_session()) as session:
            ensure_admin_role(session)
            session.commit()
            admin_user = session.get(User, identity["sub"])
            if admin_user is None:
                admin_user = User(
                    id=identity["sub"],
                    email=identity.get("email"),
                    full_name=identity.get("name"),
                    claims=identity.get("claims", {}),
                )
            if session.get(User, identity["sub"]) is None:
                session.add(admin_user)
                session.commit()
            grant_role(
                session,
                identity["sub"],
                ADMIN_ROLE_NAME,
                granted_by_user_id=identity["sub"],
            )
            session.commit()
        yield test_client


def test_user_login_counter_increments(client: TestClient):
    baseline = _read_metric(client, "user_logins_total")
    response = client.get("/v1/feeds", headers=AUTH_HEADER)
    assert response.status_code == 200
    value = _read_metric(client, "user_logins_total")
    assert value >= baseline + 1


def test_admin_action_counter_increments(client: TestClient):
    # Ensure the user is provisioned before invoking admin endpoints
    client.get("/v1/feeds", headers=AUTH_HEADER)
    labels = {"action": "list_users"}
    baseline = _read_metric(client, "admin_actions_total", labels=labels)
    response = client.get("/v1/admin/users", headers=AUTH_HEADER)
    assert response.status_code == 200
    value = _read_metric(client, "admin_actions_total", labels=labels)
    assert value >= baseline + 1


def test_api_tokens_issued_counter_increments(client: TestClient):
    client.get("/v1/feeds", headers=AUTH_HEADER)
    baseline = _read_metric(client, "api_tokens_issued_total")
    payload = {"name": "cli-token", "description": "CLI token"}
    response = client.post("/v1/me/tokens", json=payload, headers=AUTH_HEADER)
    assert response.status_code == 201
    value = _read_metric(client, "api_tokens_issued_total")
    assert value >= baseline + 1
