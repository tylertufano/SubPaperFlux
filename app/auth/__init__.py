"""Application-level helpers for managing RBAC roles, assignments, and permissions.

The :mod:`app.auth.permissions` module contains the default permission constants
and helpers that complement the role utilities provided here.
"""

from __future__ import annotations

from typing import Iterable, List, Optional, Sequence

from sqlmodel import Session, select

from ..models import Role, User, UserRole


ADMIN_ROLE_NAME = "admin"
ADMIN_ROLE_DESCRIPTION = (
    "Platform administrator with full access to global resources and settings."
)

__all__ = [
    "ADMIN_ROLE_NAME",
    "ADMIN_ROLE_DESCRIPTION",
    "ALL_PERMISSIONS",
    "ensure_role",
    "ensure_admin_role",
    "get_role_by_name",
    "get_user_roles",
    "grant_role",
    "grant_roles",
    "PERMISSION_MANAGE_BOOKMARKS",
    "PERMISSION_MANAGE_GLOBAL_CREDENTIALS",
    "PERMISSION_READ_BOOKMARKS",
    "PERMISSION_READ_GLOBAL_CREDENTIALS",
    "revoke_role",
    "ROLE_PERMISSIONS",
    "user_has_role",
    "has_permission",
    "require_permission",
]


def get_role_by_name(session: Session, role_name: str) -> Optional[Role]:
    """Return the role matching ``role_name`` or ``None`` if missing."""

    if not role_name:
        raise ValueError("role_name must be provided")
    stmt = select(Role).where(Role.name == role_name)
    return session.exec(stmt).first()


def ensure_role(
    session: Session,
    role_name: str,
    *,
    description: Optional[str] = None,
    is_system: Optional[bool] = None,
) -> Role:
    """Create or update a role with the provided metadata."""

    if not role_name:
        raise ValueError("role_name must be provided")

    role = get_role_by_name(session, role_name)
    if role:
        updated = False
        if description is not None and role.description != description:
            role.description = description
            updated = True
        if is_system is not None and role.is_system != is_system:
            role.is_system = is_system
            updated = True
        if updated:
            session.add(role)
        return role

    role = Role(
        name=role_name,
        description=description,
        is_system=is_system if is_system is not None else False,
    )
    session.add(role)
    return role


def ensure_admin_role(session: Session) -> Role:
    """Ensure the built-in administrator role exists."""

    return ensure_role(
        session,
        ADMIN_ROLE_NAME,
        description=ADMIN_ROLE_DESCRIPTION,
        is_system=True,
    )


def grant_role(
    session: Session,
    user_id: str,
    role_name: str,
    *,
    granted_by_user_id: Optional[str] = None,
    create_missing: bool = False,
    description: Optional[str] = None,
    is_system: Optional[bool] = None,
) -> UserRole:
    """Assign ``role_name`` to ``user_id`` if not already granted."""

    if not user_id:
        raise ValueError("user_id must be provided")
    if not role_name:
        raise ValueError("role_name must be provided")

    user = session.get(User, user_id)
    if user is None:
        raise ValueError(f"User {user_id!r} does not exist")

    if create_missing:
        role = ensure_role(
            session,
            role_name,
            description=description,
            is_system=is_system,
        )
    else:
        role = get_role_by_name(session, role_name)
        if role is None:
            raise ValueError(f"Role {role_name!r} does not exist")
        if description is not None or is_system is not None:
            ensure_role(
                session,
                role_name,
                description=description,
                is_system=is_system,
            )

    existing = session.get(UserRole, (user_id, role.id))
    if existing:
        return existing

    assignment = UserRole(
        user_id=user_id,
        role_id=role.id,
        granted_by_user_id=granted_by_user_id,
    )
    session.add(assignment)
    return assignment


def grant_roles(
    session: Session,
    user_id: str,
    role_names: Sequence[str] | Iterable[str],
    *,
    granted_by_user_id: Optional[str] = None,
    create_missing: bool = False,
    description: Optional[str] = None,
    is_system: Optional[bool] = None,
) -> List[UserRole]:
    """Assign multiple roles to ``user_id``."""

    assignments: List[UserRole] = []
    for role_name in role_names:
        assignments.append(
            grant_role(
                session,
                user_id,
                role_name,
                granted_by_user_id=granted_by_user_id,
                create_missing=create_missing,
                description=description,
                is_system=is_system,
            )
        )
    return assignments


def revoke_role(session: Session, user_id: str, role_name: str) -> bool:
    """Remove ``role_name`` from ``user_id``. Returns ``True`` if revoked."""

    if not user_id:
        raise ValueError("user_id must be provided")
    if not role_name:
        raise ValueError("role_name must be provided")

    role = get_role_by_name(session, role_name)
    if role is None:
        return False

    assignment = session.get(UserRole, (user_id, role.id))
    if assignment is None:
        return False

    session.delete(assignment)
    return True


def get_user_roles(session: Session, user_id: str) -> List[str]:
    """Return sorted role names assigned to ``user_id``."""

    if not user_id:
        return []

    stmt = (
        select(Role.name)
        .join(UserRole, Role.id == UserRole.role_id)
        .where(UserRole.user_id == user_id)
        .order_by(Role.name)
    )
    result = session.exec(stmt)
    return [name for name in result if name is not None]


def user_has_role(session: Session, user_id: str, role_name: str) -> bool:
    """Return ``True`` if ``user_id`` currently has ``role_name`` assigned."""

    if not user_id or not role_name:
        return False

    stmt = (
        select(Role.id)
        .join(UserRole, Role.id == UserRole.role_id)
        .where(UserRole.user_id == user_id)
        .where(Role.name == role_name)
        .limit(1)
    )
    return session.exec(stmt).first() is not None


from .permissions import (
    ALL_PERMISSIONS,
    PERMISSION_MANAGE_BOOKMARKS,
    PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
    PERMISSION_READ_BOOKMARKS,
    PERMISSION_READ_GLOBAL_CREDENTIALS,
    ROLE_PERMISSIONS,
    has_permission,
    require_permission,
)
