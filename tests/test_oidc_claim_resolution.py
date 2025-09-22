from __future__ import annotations

from typing import Any, Dict, Mapping

import pytest

from app.auth import oidc


class _DummyConfig:
    def __init__(self, userinfo_endpoint: str | None = None):
        self.issuer: str = ""
        self.userinfo_endpoint = userinfo_endpoint
        self._discovered_userinfo_endpoint: str | None = None
        self._discovery_attempted = False

    def resolve_userinfo_endpoint(self) -> str | None:
        if self.userinfo_endpoint:
            return self.userinfo_endpoint
        if self._discovery_attempted:
            return self._discovered_userinfo_endpoint

        metadata = oidc.get_oidc_discovery()
        endpoint: str | None = None
        if isinstance(metadata, Mapping):
            raw_endpoint = metadata.get("userinfo_endpoint")
            if isinstance(raw_endpoint, str):
                endpoint = raw_endpoint

        self._discovered_userinfo_endpoint = endpoint
        self._discovery_attempted = True
        if endpoint:
            self.userinfo_endpoint = endpoint
        return endpoint


def _prepare_stub(
    monkeypatch: pytest.MonkeyPatch,
    payload: Dict[str, Any],
    *,
    userinfo_endpoint: str | None = None,
) -> _DummyConfig:
    monkeypatch.setenv("DEV_NO_AUTH", "0")
    if hasattr(oidc.get_oidc_config, "cache_clear"):
        oidc.get_oidc_config.cache_clear()
    if hasattr(oidc.get_oidc_discovery, "cache_clear"):
        oidc.get_oidc_discovery.cache_clear()
    cfg = _DummyConfig(userinfo_endpoint=userinfo_endpoint)
    monkeypatch.setattr(oidc, "get_oidc_config", lambda: cfg)
    monkeypatch.setattr(oidc, "_verify_jwt", lambda token, cfg: payload)
    return cfg


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


def test_resolve_user_from_token_enriches_with_userinfo(monkeypatch: pytest.MonkeyPatch) -> None:
    payload: Dict[str, Any] = {"sub": "user-404"}
    userinfo_payload: Dict[str, Any] = {
        "name": "UserInfo Primary",
        "email": "userinfo@example.com",
        "uid": "user-404-uid",
        "groups": ["Team-A", "Team-B"],
    }
    requests: Dict[str, Any] = {}

    class _DummyResponse:
        def __init__(self, data: Dict[str, Any]):
            self._data = data

        def raise_for_status(self) -> None:  # pragma: no cover - trivial
            return None

        def json(self) -> Dict[str, Any]:  # pragma: no cover - trivial
            return self._data

    class _DummyClient:
        def __init__(self, *args: Any, **kwargs: Any):
            requests["init_args"] = (args, kwargs)

        def __enter__(self) -> "_DummyClient":  # pragma: no cover - trivial
            return self

        def __exit__(self, exc_type, exc, tb) -> None:  # pragma: no cover - trivial
            return None

        def get(self, url: str, headers: Dict[str, str] | None = None) -> _DummyResponse:
            requests["url"] = url
            requests["headers"] = headers or {}
            return _DummyResponse(userinfo_payload)

    monkeypatch.setattr(oidc.httpx, "Client", lambda *args, **kwargs: _DummyClient(*args, **kwargs))
    cfg = _prepare_stub(
        monkeypatch,
        payload,
        userinfo_endpoint="https://idp.example.com/userinfo",
    )

    identity = oidc.resolve_user_from_token("dummy-token", userinfo_bearer="dummy-access-token")

    assert requests["url"] == "https://idp.example.com/userinfo"
    assert requests["headers"]["Authorization"] == "Bearer dummy-access-token"
    assert identity["name"] == "UserInfo Primary"
    assert identity["email"] == "userinfo@example.com"
    assert identity["user_id"] == "user-404-uid"
    assert identity["groups"] == ["Team-A", "Team-B"]
    assert identity["claims"]["email"] == "userinfo@example.com"
    assert cfg.userinfo_endpoint == "https://idp.example.com/userinfo"


def test_resolve_user_from_token_discovers_userinfo_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload: Dict[str, Any] = {"sub": "user-505"}
    userinfo_payload: Dict[str, Any] = {
        "name": "UserInfo Discovered",
        "email": "discovered@example.com",
        "uid": "user-505-uid",
        "roles": ["Role-A"],
    }
    requests: Dict[str, Any] = {}
    discovery_calls = {"count": 0}

    class _DummyResponse:
        def __init__(self, data: Dict[str, Any]):
            self._data = data

        def raise_for_status(self) -> None:  # pragma: no cover - trivial
            return None

        def json(self) -> Dict[str, Any]:  # pragma: no cover - trivial
            return self._data

    class _DummyClient:
        def __init__(self, *args: Any, **kwargs: Any):
            requests["init_args"] = (args, kwargs)

        def __enter__(self) -> "_DummyClient":  # pragma: no cover - trivial
            return self

        def __exit__(self, exc_type, exc, tb) -> None:  # pragma: no cover - trivial
            return None

        def get(self, url: str, headers: Dict[str, str] | None = None) -> _DummyResponse:
            requests["count"] = requests.get("count", 0) + 1
            requests["url"] = url
            requests["headers"] = headers or {}
            return _DummyResponse(userinfo_payload)

    def _dummy_discovery() -> Dict[str, str]:
        discovery_calls["count"] += 1
        return {"userinfo_endpoint": "https://idp.example.com/userinfo"}

    monkeypatch.setattr(oidc.httpx, "Client", lambda *args, **kwargs: _DummyClient(*args, **kwargs))
    monkeypatch.setattr(oidc, "get_oidc_discovery", _dummy_discovery)
    cfg = _prepare_stub(monkeypatch, payload)

    identity = oidc.resolve_user_from_token("dummy-token", userinfo_bearer="dummy-access-token")

    assert requests["url"] == "https://idp.example.com/userinfo"
    assert requests["headers"]["Authorization"] == "Bearer dummy-access-token"
    assert identity["name"] == "UserInfo Discovered"
    assert identity["email"] == "discovered@example.com"
    assert identity["user_id"] == "user-505-uid"
    assert identity["groups"] == ["Role-A"]
    assert cfg.userinfo_endpoint == "https://idp.example.com/userinfo"
    assert discovery_calls["count"] == 1

    oidc.resolve_user_from_token("dummy-token", userinfo_bearer="dummy-access-token")

    assert discovery_calls["count"] == 1
