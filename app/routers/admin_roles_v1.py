"""Versioned administrative role management endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, status
from sqlalchemy import func, or_
from sqlmodel import Session, select

from ..audit import record_audit_log
from ..auth import ADMIN_ROLE_NAME, ensure_role, get_role_by_name
from ..auth.oidc import get_current_user
from ..db import get_session
from ..models import Role, UserRole
from ..schemas import (
    AdminRoleCreate,
    AdminRoleDetail,
    AdminRoleListItem,
    AdminRoleUpdate,
    AdminRolesPage,
)
from .admin import _record_admin_action_metric, _require_admin


router = APIRouter(prefix="/v1/admin/roles", tags=["v1", "admin"])


def _normalize_whitespace(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = " ".join(value.split()).strip()
    return normalized or None


def _serialize_role_list_item(role: Role, assigned_user_count: int) -> AdminRoleListItem:
    return AdminRoleListItem(
        id=role.id,
        name=role.name,
        description=role.description,
        is_system=role.is_system,
        created_at=role.created_at,
        updated_at=role.updated_at,
        assigned_user_count=assigned_user_count,
    )


def _serialize_role_detail(role: Role, assigned_user_count: int) -> AdminRoleDetail:
    base = _serialize_role_list_item(role, assigned_user_count)
    return AdminRoleDetail(**base.model_dump(), metadata={})


def _get_assigned_user_count(session: Session, role_id: str) -> int:
    stmt = select(func.count()).select_from(UserRole).where(UserRole.role_id == role_id)
    return int(session.exec(stmt).one() or 0)


@router.get("", response_model=AdminRolesPage, summary="List roles")
def list_roles(
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    search: Optional[str] = Query(None, description="Filter by role name or description"),
):
    _require_admin(session, current_user)

    stmt = (
        select(Role, func.count(UserRole.user_id).label("assigned_user_count"))
        .join(UserRole, UserRole.role_id == Role.id, isouter=True)
        .group_by(Role.id)
    )
    count_stmt = select(func.count()).select_from(Role)

    if search:
        term = f"%{search.lower()}%"
        condition = or_(
            func.lower(Role.name).like(term),
            func.lower(Role.description).like(term),
        )
        stmt = stmt.where(condition)
        count_stmt = count_stmt.where(condition)

    stmt = stmt.order_by(Role.created_at.desc())

    offset = (page - 1) * size
    rows = session.exec(stmt.offset(offset).limit(size)).all()
    total = int(session.exec(count_stmt).one() or 0)

    items = [
        _serialize_role_list_item(role, int(assigned_count or 0))
        for role, assigned_count in rows
    ]
    has_next = (page * size) < total
    total_pages = int((total + size - 1) // size) if size else 1
    result = AdminRolesPage(
        items=items,
        total=total,
        page=page,
        size=size,
        has_next=has_next,
        total_pages=total_pages,
    )
    _record_admin_action_metric("list_roles")
    return result


@router.post(
    "",
    response_model=AdminRoleDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Create a role",
)
def create_role(
    *,
    payload: AdminRoleCreate = Body(...),
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
):
    actor_id = _require_admin(session, current_user)

    normalized_name = _normalize_whitespace(payload.name)
    if not normalized_name:
        raise HTTPException(status_code=400, detail="Role name must not be empty")

    existing = get_role_by_name(session, normalized_name)
    if existing:
        raise HTTPException(status_code=409, detail="Role already exists")

    normalized_description = _normalize_whitespace(payload.description)
    is_system = bool(payload.is_system) if payload.is_system is not None else False

    role = ensure_role(
        session,
        normalized_name,
        description=normalized_description,
        is_system=is_system,
    )

    record_audit_log(
        session,
        entity_type="role",
        entity_id=role.id,
        action="create",
        owner_user_id=None,
        actor_user_id=actor_id,
        details={
            "name": role.name,
            "description": role.description,
            "is_system": role.is_system,
        },
    )
    session.commit()
    session.refresh(role)

    result = _serialize_role_detail(role, 0)
    _record_admin_action_metric("create_role")
    return result


@router.get(
    "/{role_id}",
    response_model=AdminRoleDetail,
    summary="Get role details",
)
def get_role(
    *,
    role_id: str = Path(..., min_length=1),
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _require_admin(session, current_user)

    stmt = (
        select(Role, func.count(UserRole.user_id).label("assigned_user_count"))
        .join(UserRole, UserRole.role_id == Role.id, isouter=True)
        .where(Role.id == role_id)
        .group_by(Role.id)
    )
    row = session.exec(stmt).first()
    if not row:
        raise HTTPException(status_code=404, detail="Role not found")
    role, assigned_count = row
    result = _serialize_role_detail(role, int(assigned_count or 0))
    _record_admin_action_metric("get_role")
    return result


@router.patch(
    "/{role_id}",
    response_model=AdminRoleDetail,
    summary="Update a role",
)
def update_role(
    *,
    role_id: str = Path(..., min_length=1),
    payload: AdminRoleUpdate = Body(...),
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
):
    actor_id = _require_admin(session, current_user)

    role = session.get(Role, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    changes: Dict[str, Dict[str, Optional[str]]] = {}

    if payload.name is not None:
        normalized_name = _normalize_whitespace(payload.name)
        if not normalized_name:
            raise HTTPException(status_code=400, detail="Role name must not be empty")
        if role.is_system and normalized_name != role.name:
            raise HTTPException(status_code=400, detail="System roles cannot be renamed")
        existing = get_role_by_name(session, normalized_name)
        if existing and existing.id != role.id:
            raise HTTPException(status_code=409, detail="Role already exists")
        if normalized_name != role.name:
            changes["name"] = {"previous": role.name, "next": normalized_name}
            role.name = normalized_name

    if payload.description is not None:
        normalized_description = _normalize_whitespace(payload.description)
        if normalized_description != role.description:
            changes["description"] = {
                "previous": role.description,
                "next": normalized_description,
            }
            role.description = normalized_description

    if not changes:
        assigned_count = _get_assigned_user_count(session, role.id)
        result = _serialize_role_detail(role, assigned_count)
        _record_admin_action_metric("update_role")
        return result

    role.updated_at = datetime.now(timezone.utc)
    session.add(role)

    record_audit_log(
        session,
        entity_type="role",
        entity_id=role.id,
        action="update",
        owner_user_id=None,
        actor_user_id=actor_id,
        details={"changes": changes},
    )
    session.commit()
    session.refresh(role)

    assigned_count = _get_assigned_user_count(session, role.id)
    result = _serialize_role_detail(role, assigned_count)
    _record_admin_action_metric("update_role")
    return result


@router.delete(
    "/{role_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a role",
)
def delete_role(
    *,
    role_id: str = Path(..., min_length=1),
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
):
    actor_id = _require_admin(session, current_user)

    role = session.get(Role, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    if role.is_system or role.name == ADMIN_ROLE_NAME:
        raise HTTPException(status_code=400, detail="Cannot delete system roles")

    session.delete(role)
    record_audit_log(
        session,
        entity_type="role",
        entity_id=role_id,
        action="delete",
        owner_user_id=None,
        actor_user_id=actor_id,
        details={"name": role.name},
    )
    session.commit()

    _record_admin_action_metric("delete_role")
    return None
