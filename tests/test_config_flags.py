"""Tests for user-management configuration flag helpers."""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    """Ensure feature flag caches are reset between tests."""

    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    monkeypatch.delenv("USER_MGMT_CORE", raising=False)
    monkeypatch.delenv("USER_MGMT_ENFORCE", raising=False)
    monkeypatch.delenv("USER_MGMT_RLS_ENFORCE", raising=False)
    monkeypatch.delenv("SCIM_ENABLED", raising=False)
    monkeypatch.delenv("SCIM_WRITE_ENABLED", raising=False)

    from app.config import (
        is_rls_enforced,
        is_scim_enabled,
        is_scim_write_enabled,
        is_user_mgmt_core_enabled,
        is_user_mgmt_enforce_enabled,
    )

    is_rls_enforced.cache_clear()
    is_scim_enabled.cache_clear()
    is_scim_write_enabled.cache_clear()
    is_user_mgmt_core_enabled.cache_clear()
    is_user_mgmt_enforce_enabled.cache_clear()
    try:
        yield
    finally:
        is_rls_enforced.cache_clear()
        is_scim_enabled.cache_clear()
        is_scim_write_enabled.cache_clear()
        is_user_mgmt_core_enabled.cache_clear()
        is_user_mgmt_enforce_enabled.cache_clear()


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, True),
        ("", True),
        ("0", False),
        ("off", False),
        ("false", False),
        ("no", False),
        ("1", True),
        ("true", True),
        ("yes", True),
        ("On", True),
        (" 1 ", True),
    ],
)
def test_is_user_mgmt_enforce_enabled(value, expected, monkeypatch):
    """``is_user_mgmt_enforce_enabled`` reflects the current environment value."""

    from app.config import is_user_mgmt_enforce_enabled

    if value is None:
        monkeypatch.delenv("USER_MGMT_ENFORCE", raising=False)
    else:
        monkeypatch.setenv("USER_MGMT_ENFORCE", value)

    is_user_mgmt_enforce_enabled.cache_clear()
    try:
        assert is_user_mgmt_enforce_enabled() is expected
    finally:
        is_user_mgmt_enforce_enabled.cache_clear()


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, True),
        ("", True),
        ("0", False),
        ("off", False),
        ("false", False),
        ("no", False),
        ("1", True),
        ("true", True),
        ("yes", True),
        ("On", True),
        (" 1 ", True),
    ],
)
def test_is_user_mgmt_core_enabled(value, expected, monkeypatch):
    """``is_user_mgmt_core_enabled`` reflects the current environment value."""

    from app.config import is_user_mgmt_core_enabled

    if value is None:
        monkeypatch.delenv("USER_MGMT_CORE", raising=False)
    else:
        monkeypatch.setenv("USER_MGMT_CORE", value)

    is_user_mgmt_core_enabled.cache_clear()
    try:
        assert is_user_mgmt_core_enabled() is expected
    finally:
        is_user_mgmt_core_enabled.cache_clear()


def test_is_rls_enforced_defaults_to_enforcement(monkeypatch):
    """``is_rls_enforced`` falls back to the enforcement flag when unset."""

    from app.config import is_rls_enforced, is_user_mgmt_enforce_enabled

    monkeypatch.setenv("USER_MGMT_ENFORCE", "0")
    is_user_mgmt_enforce_enabled.cache_clear()
    is_rls_enforced.cache_clear()
    assert is_rls_enforced() is False

    monkeypatch.setenv("USER_MGMT_RLS_ENFORCE", "1")
    is_rls_enforced.cache_clear()
    assert is_rls_enforced() is True

    monkeypatch.setenv("USER_MGMT_RLS_ENFORCE", "0")
    is_rls_enforced.cache_clear()
    assert is_rls_enforced() is False


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, False),
        ("", False),
        ("0", False),
        ("off", False),
        ("1", True),
        ("true", True),
        ("yes", True),
        ("On", True),
    ],
)
def test_is_scim_enabled(value, expected, monkeypatch):
    """``is_scim_enabled`` honours the environment configuration."""

    from app.config import is_scim_enabled

    if value is None:
        monkeypatch.delenv("SCIM_ENABLED", raising=False)
    else:
        monkeypatch.setenv("SCIM_ENABLED", value)

    is_scim_enabled.cache_clear()
    try:
        assert is_scim_enabled() is expected
    finally:
        is_scim_enabled.cache_clear()


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, True),
        ("", True),
        ("0", False),
        ("off", False),
        ("false", False),
        ("no", False),
        ("1", True),
        ("true", True),
        ("yes", True),
        ("On", True),
    ],
)
def test_is_scim_write_enabled(value, expected, monkeypatch):
    """``is_scim_write_enabled`` honours the environment configuration."""

    from app.config import is_scim_write_enabled

    if value is None:
        monkeypatch.delenv("SCIM_WRITE_ENABLED", raising=False)
    else:
        monkeypatch.setenv("SCIM_WRITE_ENABLED", value)

    is_scim_write_enabled.cache_clear()
    try:
        assert is_scim_write_enabled() is expected
    finally:
        is_scim_write_enabled.cache_clear()
