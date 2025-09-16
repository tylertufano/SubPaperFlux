"""Versioned administrative user management endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, status
from sqlalchemy import func, or_
from sqlmodel import Session, select

from ..audit import record_audit_log
from ..auth import ADMIN_ROLE_NAME, get_user_roles, grant_role, revoke_role
from ..auth.oidc import get_current_user
from ..auth.rbac import is_admin
from ..db import get_session
from ..models import Role, User, UserRole
from ..schemas import AdminUserOut, AdminUserUpdate, AdminUsersPage, RoleGrantRequest
from .admin import _require_admin


router = APIRouter(prefix="/v1/admin/users", tags=["v1", "admin"])


def _normalize_groups(user: User) -> List[str]:
    claims = user.claims if isinstance(user.claims, dict) else {}
    raw_groups: Iterable = claims.get("groups") or claims.get("roles") or []
    groups: List[str] = []
    for value in raw_groups:
        if value is None:
            continue
        text = str(value).strip()
        if not text:
            continue
        groups.append(text)
    return groups


def _serialize_user(session: Session, user: User) -> AdminUserOut:
    roles = get_user_roles(session, user.id)
    groups = _normalize_groups(user)
    is_admin_flag = ADMIN_ROLE_NAME in roles or is_admin({"groups": groups})
    return AdminUserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        picture_url=user.picture_url,
        is_active=user.is_active,
        created_at=user.created_at,
        updated_at=user.updated_at,
        last_login_at=user.last_login_at,
        groups=groups,
        roles=roles,
        is_admin=is_admin_flag,
    )


@router.get("", response_model=AdminUsersPage, summary="List users")
def list_users(
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    search: Optional[str] = Query(None, description="Filter by email, name, or id"),
    is_active: Optional[bool] = Query(None),
    role: Optional[str] = Query(None, description="Filter by assigned role name"),
):
    _require_admin(session, current_user)

    filters = []
    if search:
        term = f"%{search.lower()}%"
        filters.append(
            or_(
                func.lower(User.email).like(term),
                func.lower(User.full_name).like(term),
                func.lower(User.id).like(term),
            )
        )
    if is_active is not None:
        filters.append(User.is_active == is_active)

    stmt = select(User)
    count_stmt = select(func.count(func.distinct(User.id))).select_from(User)

    if role:
        stmt = (
            stmt.join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(Role.name == role)
        )
        count_stmt = (
            count_stmt.join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(Role.name == role)
        )

    if filters:
        stmt = stmt.where(*filters)
        count_stmt = count_stmt.where(*filters)

    stmt = stmt.distinct().order_by(User.created_at.desc())

    offset = (page - 1) * size
    rows = session.exec(stmt.offset(offset).limit(size)).all()
    total = int(session.exec(count_stmt).one() or 0)

    items = [_serialize_user(session, row) for row in rows]
    has_next = (page * size) < total
    total_pages = int((total + size - 1) // size) if size else 1

    return AdminUsersPage(
        items=items,
        total=total,
        page=page,
        size=size,
        has_next=has_next,
        total_pages=total_pages,
    )


@router.get("/{user_id}", response_model=AdminUserOut, summary="Get a user")
def get_user(
    user_id: str = Path(..., min_length=1),
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _require_admin(session, current_user)
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _serialize_user(session, user)


@router.patch(
    "/{user_id}",
    response_model=AdminUserOut,
    summary="Update a user",
)
def update_user(
    *,
    user_id: str = Path(..., min_length=1),
    payload: AdminUserUpdate = Body(...),
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
):
    actor_id = _require_admin(session, current_user)
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    updated = False
    now = datetime.now(timezone.utc)

    if payload.is_active is not None and payload.is_active != user.is_active:
        if payload.is_active is False and not payload.confirm:
            raise HTTPException(status_code=400, detail="Confirmation required to suspend user")
        user.is_active = payload.is_active
        updated = True
        user.updated_at = now
        record_audit_log(
            session,
            entity_type="user",
            entity_id=user.id,
            action="activate" if payload.is_active else "suspend",
            owner_user_id=user.id,
            actor_user_id=actor_id,
            details={"is_active": payload.is_active},
        )

    if not updated:
        return _serialize_user(session, user)

    session.add(user)
    session.commit()
    session.refresh(user)
    return _serialize_user(session, user)


@router.post(
    "/{user_id}/roles/{role_name}",
    response_model=AdminUserOut,
    summary="Grant a role to a user",
)
def grant_user_role(
    *,
    user_id: str = Path(..., min_length=1),
    role_name: str = Path(..., min_length=1),
    payload: Optional[RoleGrantRequest] = Body(None),
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
):
    actor_id = _require_admin(session, current_user)
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    request = payload or RoleGrantRequest()
    granted_by = actor_id

    try:
        grant_role(
            session,
            user_id,
            role_name,
            granted_by_user_id=granted_by,
            create_missing=request.create_missing,
            description=request.description,
            is_system=request.is_system,
        )
    except ValueError as exc:  # Translate domain errors into HTTP failures
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    record_audit_log(
        session,
        entity_type="user_role",
        entity_id=f"{user_id}:{role_name}",
        action="grant",
        owner_user_id=user_id,
        actor_user_id=granted_by,
        details={"role": role_name},
    )
    session.commit()
    session.refresh(user)
    return _serialize_user(session, user)


@router.delete(
    "/{user_id}/roles/{role_name}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke a role from a user",
)
def revoke_user_role(
    *,
    user_id: str = Path(..., min_length=1),
    role_name: str = Path(..., min_length=1),
    confirm: bool = Query(
        False,
        description="Set to true to confirm revoking the specified role assignment.",
    ),
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
):
    actor_id = _require_admin(session, current_user)
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not confirm:
        raise HTTPException(status_code=400, detail="Confirmation required to revoke role")

    if not revoke_role(session, user_id, role_name):
        raise HTTPException(status_code=404, detail="Role assignment not found")

    record_audit_log(
        session,
        entity_type="user_role",
        entity_id=f"{user_id}:{role_name}",
        action="revoke",
        owner_user_id=user_id,
        actor_user_id=actor_id,
        details={"role": role_name},
    )
    session.commit()

