"""Deprecated group-based RBAC helpers.

The application now resolves permissions through :mod:`app.auth.permissions`.
These thin wrappers remain for backward compatibility only and delegate to the
new helper functions while emitting :class:`DeprecationWarning` so new code can
transition away from them.
"""

from __future__ import annotations

import warnings
from typing import Any

from sqlmodel import Session

from .permissions import (
    PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
    PERMISSION_MANAGE_GLOBAL_SITE_CONFIGS,
    has_permission,
)

__all__ = [
    "is_admin",
    "can_manage_global_site_configs",
    "can_manage_global_credentials",
]


def is_admin(session: Session, current_user: Any) -> bool:
    """Return ``True`` when ``current_user`` can administer global resources.

    The legacy group-based check is replaced by a call to
    :func:`app.auth.permissions.has_permission`. The function keeps the original
    boolean contract but raises :class:`DeprecationWarning` to encourage callers
    to migrate to the new permission API.
    """

    warnings.warn(
        "is_admin() is deprecated; use has_permission() or user_has_role() instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    return has_permission(session, current_user, PERMISSION_MANAGE_GLOBAL_SITE_CONFIGS)


def can_manage_global_site_configs(session: Session, current_user: Any) -> bool:
    """Return ``True`` if ``current_user`` may manage global site configs."""

    warnings.warn(
        "can_manage_global_site_configs() is deprecated; call has_permission() "
        "with PERMISSION_MANAGE_GLOBAL_SITE_CONFIGS instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    return has_permission(session, current_user, PERMISSION_MANAGE_GLOBAL_SITE_CONFIGS)


def can_manage_global_credentials(session: Session, current_user: Any) -> bool:
    """Return ``True`` if ``current_user`` may manage global credentials."""

    warnings.warn(
        "can_manage_global_credentials() is deprecated; call has_permission() "
        "with PERMISSION_MANAGE_GLOBAL_CREDENTIALS instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    return has_permission(session, current_user, PERMISSION_MANAGE_GLOBAL_CREDENTIALS)
