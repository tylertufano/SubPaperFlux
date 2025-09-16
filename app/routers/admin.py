from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlmodel import select

from ..auth.oidc import get_current_user
from ..auth.rbac import is_admin
from ..db import get_session, is_postgres
from ..db_admin import prepare_postgres_search, enable_rls
from ..models import AuditLog
from ..schemas import AuditLogOut, AuditLogsPage


router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/postgres/prepare", response_model=dict)
def postgres_prepare(current_user=Depends(get_current_user), session=Depends(get_session)):
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not is_postgres():
        raise HTTPException(status_code=400, detail="Not using Postgres backend")
    details = prepare_postgres_search(session)
    return {"ok": bool(details.get("ok", True)), "details": details}


@router.post("/postgres/enable-rls", response_model=dict)
def postgres_enable_rls(current_user=Depends(get_current_user), session=Depends(get_session)):
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not is_postgres():
        raise HTTPException(status_code=400, detail="Not using Postgres backend")
    details = enable_rls(session)
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
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail="Forbidden")

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
    return AuditLogsPage(
        items=items,
        total=total,
        page=page,
        size=size,
        has_next=has_next,
        total_pages=total_pages,
    )
