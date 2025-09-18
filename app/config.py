"""Application configuration helpers for user-management feature flags."""

from __future__ import annotations

import os
from functools import lru_cache

_TRUE_VALUES = {"1", "true", "yes", "on"}

__all__ = [
    "is_user_mgmt_core_enabled",
    "is_user_mgmt_enforce_enabled",
]


@lru_cache(maxsize=1)
def is_user_mgmt_core_enabled() -> bool:
    """Return ``True`` when the core user-management features are enabled."""

    value = os.getenv("USER_MGMT_CORE")
    if value is None:
        return False
    return value.strip().lower() in _TRUE_VALUES


@lru_cache(maxsize=1)
def is_user_mgmt_enforce_enabled() -> bool:
    """Return ``True`` when user-management enforcement is enabled."""

    value = os.getenv("USER_MGMT_ENFORCE")
    if value is None:
        return False
    return value.strip().lower() in _TRUE_VALUES
