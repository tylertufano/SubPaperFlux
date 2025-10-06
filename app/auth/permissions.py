"""Default permission constants and role assignments used by application RBAC.

Default assignments
-------------------
- ``ADMIN_ROLE_NAME`` grants every permission defined in this module, covering
  shared credentials and bookmark management.

The mapping is intentionally small so future roles can be introduced by adding
entries to :data:`ROLE_PERMISSIONS` without altering existing checks.
"""

from __future__ import annotations

from typing import Any, FrozenSet, Mapping, Optional

from fastapi import HTTPException
from sqlmodel import Session

from app.auth import ADMIN_ROLE_NAME, get_user_roles

PERMISSION_READ_GLOBAL_CREDENTIALS = "credentials:read"
PERMISSION_MANAGE_GLOBAL_CREDENTIALS = "credentials:manage"
PERMISSION_READ_BOOKMARKS = "bookmarks:read"
PERMISSION_MANAGE_BOOKMARKS = "bookmarks:manage"

ALL_PERMISSIONS: FrozenSet[str] = frozenset(
    {
        PERMISSION_READ_GLOBAL_CREDENTIALS,
        PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
        PERMISSION_READ_BOOKMARKS,
        PERMISSION_MANAGE_BOOKMARKS,
    }
)

ROLE_PERMISSIONS: Mapping[str, FrozenSet[str]] = {
    ADMIN_ROLE_NAME: ALL_PERMISSIONS,
    # Future roles can be added here, for example:
    # "reader": frozenset({PERMISSION_READ_BOOKMARKS}),
}

def _resolve_user_id(current_user: Any) -> Optional[str]:
    """Return a string user id from ``current_user`` if available."""

    if current_user is None:
        return None

    if isinstance(current_user, str):
        return current_user or None

    if isinstance(current_user, dict):
        for key in ("sub", "id", "user_id"):
            value = current_user.get(key)
            if value:
                return str(value)
        return None

    for attr in ("id", "user_id", "sub"):
        value = getattr(current_user, attr, None)
        if value:
            return str(value)

    return None


def has_permission(
    session: Session,
    current_user: Any,
    permission: str,
    owner_id: Optional[str] = None,
) -> bool:
    """Return ``True`` if ``current_user`` can perform ``permission`` on ``owner_id``.

    ``owner_id`` represents the resource owner. ``None`` denotes a global resource
    which always requires explicit permissions. When the resource is owned by the
    current user, access is granted regardless of role assignments.
    """

    if not permission:
        return False

    user_id = _resolve_user_id(current_user)
    if not user_id:
        return False

    if owner_id is not None and str(owner_id) == user_id:
        return True

    roles = get_user_roles(session, user_id)
    if not roles:
        return False

    if ADMIN_ROLE_NAME in roles:
        return True

    for role in roles:
        allowed = ROLE_PERMISSIONS.get(role)
        if allowed and permission in allowed:
            return True

    return False


def require_permission(
    session: Session,
    current_user: Any,
    permission: str,
    owner_id: Optional[str] = None,
) -> None:
    """Raise :class:`HTTPException` if ``current_user`` lacks ``permission``."""

    if not has_permission(session, current_user, permission, owner_id):
        raise HTTPException(status_code=403, detail="Forbidden")


__all__ = [
    "PERMISSION_READ_GLOBAL_CREDENTIALS",
    "PERMISSION_MANAGE_GLOBAL_CREDENTIALS",
    "PERMISSION_READ_BOOKMARKS",
    "PERMISSION_MANAGE_BOOKMARKS",
    "ALL_PERMISSIONS",
    "ROLE_PERMISSIONS",
    "has_permission",
    "require_permission",
]
