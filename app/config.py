"""Application configuration helpers."""

from __future__ import annotations

import os
from functools import lru_cache

_TRUE_VALUES = {"1", "true", "yes", "on"}


@lru_cache(maxsize=1)
def is_user_mgmt_core_enabled() -> bool:
    """Return ``True`` when the core user-management features are enabled."""

    value = os.getenv("USER_MGMT_CORE")
    if value is None:
        return False
    return value.strip().lower() in _TRUE_VALUES
