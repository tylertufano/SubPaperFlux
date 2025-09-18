from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlmodel import select

from ..audit import record_audit_log
from ..auth import (
    ADMIN_ROLE_NAME,
    PERMISSION_MANAGE_GLOBAL_SITE_CONFIGS,
    has_permission,
    user_has_role,
)
from ..auth.oidc import get_current_user
from ..db import get_session, get_session_user_id, is_postgres
from ..db_admin import prepare_postgres_search, enable_rls
from ..models import AuditLog
from ..observability.metrics import increment_admin_action
from ..schemas import AuditLogOut, AuditLogsPage


router = APIRouter(prefix="/admin", tags=["admin"])


def _require_admin(session, current_user) -> str:
    current_user_data = current_user if isinstance(current_user, dict) else {}
    request_user_id = current_user_data.get("sub")
    session_user_id = get_session_user_id(session)

    if session_user_id and request_user_id and session_user_id != request_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    resolved_user_id = session_user_id or request_user_id
    if not resolved_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    identity_for_check: object
    if isinstance(current_user, dict):
        identity_for_check = dict(current_user)
    else:
        identity_for_check = current_user

    if resolved_user_id:
        if isinstance(identity_for_check, dict):
            identity_for_check.setdefault("sub", resolved_user_id)
        else:
            identity_for_check = {"sub": resolved_user_id}

    if has_permission(
        session, identity_for_check, PERMISSION_MANAGE_GLOBAL_SITE_CONFIGS
    ):
        return resolved_user_id

    if user_has_role(session, resolved_user_id, ADMIN_ROLE_NAME):
        return resolved_user_id
    raise HTTPException(status_code=403, detail="Forbidden")


def _record_admin_action_metric(action: str) -> None:
    increment_admin_action(action)


@router.post("/postgres/prepare", response_model=dict)
def postgres_prepare(current_user=Depends(get_current_user), session=Depends(get_session)):
    actor_id = _require_admin(session, current_user)
    if not is_postgres():
        raise HTTPException(status_code=400, detail="Not using Postgres backend")
    details = prepare_postgres_search(session)
    record_audit_log(
        session,
        entity_type="admin_action",
        entity_id="postgres_prepare",
        action="postgres_prepare",
        owner_user_id=actor_id,
        actor_user_id=actor_id,
        details=details,
    )
    session.commit()
    _record_admin_action_metric("postgres_prepare")
    return {"ok": bool(details.get("ok", True)), "details": details}


@router.post("/postgres/enable-rls", response_model=dict)
def postgres_enable_rls(current_user=Depends(get_current_user), session=Depends(get_session)):
    actor_id = _require_admin(session, current_user)
    if not is_postgres():
        raise HTTPException(status_code=400, detail="Not using Postgres backend")
    details = enable_rls(session)
    record_audit_log(
        session,
        entity_type="admin_action",
        entity_id="postgres_enable_rls",
        action="postgres_enable_rls",
        owner_user_id=actor_id,
        actor_user_id=actor_id,
        details=details,
    )
    session.commit()
    _record_admin_action_metric("postgres_enable_rls")
    return {"ok": bool(details.get("ok", True)), "details": details}


@router.get("/audit", response_model=AuditLogsPage, summary="List audit log entries")
@router.get("/audit/", response_model=AuditLogsPage, summary="List audit log entries")
def list_audit_logs(
    current_user=Depends(get_current_user),
    session=Depends(get_session),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    action: Optional[str] = None,
    owner_user_id: Optional[str] = None,
    actor_user_id: Optional[str] = None,
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
):
    _require_admin(session, current_user)

    filters = []
    if entity_type:
        filters.append(AuditLog.entity_type == entity_type)
    if entity_id:
        filters.append(AuditLog.entity_id == entity_id)
    if action:
        filters.append(AuditLog.action == action)
    if owner_user_id:
        filters.append(AuditLog.owner_user_id == owner_user_id)
    if actor_user_id:
        filters.append(AuditLog.actor_user_id == actor_user_id)
    if since:
        filters.append(AuditLog.created_at >= since)
    if until:
        filters.append(AuditLog.created_at <= until)

    count_stmt = select(func.count()).select_from(AuditLog)
    if filters:
        count_stmt = count_stmt.where(*filters)
    total = int(session.exec(count_stmt).one())

    stmt = select(AuditLog)
    if filters:
        stmt = stmt.where(*filters)
    offset = (page - 1) * size
    stmt = stmt.order_by(AuditLog.created_at.desc()).offset(offset).limit(size)
    rows = session.exec(stmt).all()

    items = [
        AuditLogOut(
            id=row.id,
            entity_type=row.entity_type,
            entity_id=row.entity_id,
            action=row.action,
            owner_user_id=row.owner_user_id,
            actor_user_id=row.actor_user_id,
            details=row.details or {},
            created_at=row.created_at,
        )
        for row in rows
    ]
    has_next = (page * size) < total
    total_pages = int((total + size - 1) // size) if size else 1
    result = AuditLogsPage(
        items=items,
        total=total,
        page=page,
        size=size,
        has_next=has_next,
        total_pages=total_pages,
    )
    _record_admin_action_metric("list_audit_logs")
    return result
