"""Default permission constants and role assignments used by application RBAC.

Default assignments
-------------------
- ``ADMIN_ROLE_NAME`` grants every permission defined in this module, covering
  global site configuration, shared credentials, and bookmark management.

The mapping is intentionally small so future roles can be introduced by adding
entries to :data:`ROLE_PERMISSIONS` without altering existing checks.
"""

from __future__ import annotations

from typing import FrozenSet, Mapping

from app.auth import ADMIN_ROLE_NAME

PERMISSION_READ_GLOBAL_SITE_CONFIGS = "site_configs:read"
PERMISSION_MANAGE_GLOBAL_SITE_CONFIGS = "site_configs:manage"
PERMISSION_READ_GLOBAL_CREDENTIALS = "credentials:read"
PERMISSION_MANAGE_GLOBAL_CREDENTIALS = "credentials:manage"
PERMISSION_READ_BOOKMARKS = "bookmarks:read"
PERMISSION_MANAGE_BOOKMARKS = "bookmarks:manage"

ALL_PERMISSIONS: FrozenSet[str] = frozenset(
    {
        PERMISSION_READ_GLOBAL_SITE_CONFIGS,
        PERMISSION_MANAGE_GLOBAL_SITE_CONFIGS,
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

__all__ = [
    "PERMISSION_READ_GLOBAL_SITE_CONFIGS",
    "PERMISSION_MANAGE_GLOBAL_SITE_CONFIGS",
    "PERMISSION_READ_GLOBAL_CREDENTIALS",
    "PERMISSION_MANAGE_GLOBAL_CREDENTIALS",
    "PERMISSION_READ_BOOKMARKS",
    "PERMISSION_MANAGE_BOOKMARKS",
    "ALL_PERMISSIONS",
    "ROLE_PERMISSIONS",
]
