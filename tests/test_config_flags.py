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

    from app.config import (
        is_user_mgmt_core_enabled,
        is_user_mgmt_enforce_enabled,
    )

    is_user_mgmt_core_enabled.cache_clear()
    is_user_mgmt_enforce_enabled.cache_clear()
    try:
        yield
    finally:
        is_user_mgmt_core_enabled.cache_clear()
        is_user_mgmt_enforce_enabled.cache_clear()


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, False),
        ("", False),
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
