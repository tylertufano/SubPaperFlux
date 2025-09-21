from __future__ import annotations

from typing import Any, Dict

import pytest

from app.auth import oidc


class _DummyConfig:
    pass


def _prepare_stub(monkeypatch: pytest.MonkeyPatch, payload: Dict[str, Any]) -> None:
    monkeypatch.setenv("DEV_NO_AUTH", "0")
    if hasattr(oidc.get_oidc_config, "cache_clear"):
        oidc.get_oidc_config.cache_clear()
    monkeypatch.setattr(oidc, "get_oidc_config", lambda: _DummyConfig())
    monkeypatch.setattr(oidc, "_verify_jwt", lambda token, cfg: payload)


def test_resolve_user_from_token_handles_namespaced_claims(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
        "sub": "user-202",
        "given_name": "Jordan",
        "family_name": "Fischer",
        "emails": ["jordan@example.com"],
        "oid": "guid-202",
        "groups": ["Engineering", "QA"],
    }
    _prepare_stub(monkeypatch, payload)

    identity = oidc.resolve_user_from_token("dummy-token")

    assert identity["sub"] == "user-202"
    assert identity["name"] == "Jordan Fischer"
    assert identity["email"] == "jordan@example.com"
    assert identity["user_id"] == "guid-202"
    assert identity["groups"] == ["Engineering", "QA"]


def test_resolve_user_from_token_falls_back_to_role_claims(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
        "sub": "user-303",
        "name": "Role Only",
        "roles": ["Admin", "Editor"],
        "userprincipalname": "role.only@example.com",
    }
    _prepare_stub(monkeypatch, payload)

    identity = oidc.resolve_user_from_token("dummy-token")

    assert identity["name"] == "Role Only"
    assert identity["email"] == "role.only@example.com"
    assert identity["groups"] == ["Admin", "Editor"]
