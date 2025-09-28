"""Application configuration helpers for user-management feature flags."""

from __future__ import annotations

import os
from functools import lru_cache

_TRUE_VALUES = {"1", "true", "yes", "on"}


def _read_flag(name: str) -> bool | None:
    """Return the parsed boolean value for ``name`` if explicitly set."""

    value = os.getenv(name)
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    return normalized.lower() in _TRUE_VALUES

__all__ = [
    "is_user_mgmt_core_enabled",
    "is_user_mgmt_enforce_enabled",
    "is_user_mgmt_oidc_only",
    "is_rls_enforced",
    "is_scim_enabled",
    "is_scim_write_enabled",
]


@lru_cache(maxsize=1)
def is_user_mgmt_core_enabled() -> bool:
    """Return ``True`` when the core user-management features are enabled."""

    flag = _read_flag("USER_MGMT_CORE")
    if flag is None:
        return True
    return flag


@lru_cache(maxsize=1)
def is_user_mgmt_enforce_enabled() -> bool:
    """Return ``True`` when user-management enforcement is enabled."""

    flag = _read_flag("USER_MGMT_ENFORCE")
    if flag is None:
        return True
    return flag


@lru_cache(maxsize=1)
def is_user_mgmt_oidc_only() -> bool:
    """Return ``True`` when only OIDC-backed identities are allowed."""

    flag = _read_flag("USER_MGMT_OIDC_ONLY")
    if flag is None:
        return False
    return flag


@lru_cache(maxsize=1)
def is_rls_enforced() -> bool:
    """Return ``True`` when row-level security enforcement should run.

    Prefers the dedicated ``USER_MGMT_RLS_ENFORCE`` flag when set, otherwise
    falls back to ``USER_MGMT_ENFORCE`` for backwards compatibility.
    """

    flag = _read_flag("USER_MGMT_RLS_ENFORCE")
    if flag is not None:
        return flag
    return is_user_mgmt_enforce_enabled()


@lru_cache(maxsize=1)
def is_scim_enabled() -> bool:
    """Return ``True`` when the SCIM provisioning API should be exposed."""

    flag = _read_flag("SCIM_ENABLED")
    if flag is None:
        return False
    return flag


@lru_cache(maxsize=1)
def is_scim_write_enabled() -> bool:
    """Return ``True`` when SCIM write operations are allowed."""

    flag = _read_flag("SCIM_WRITE_ENABLED")
    if flag is None:
        return True
    return flag
