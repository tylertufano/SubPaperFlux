"""Audit log helper utilities."""

from __future__ import annotations

from typing import Any, Dict, Optional

from sqlmodel import Session

from .models import AuditLog


def record_audit_log(
    session: Session,
    *,
    entity_type: str,
    entity_id: str,
    action: str,
    owner_user_id: Optional[str],
    actor_user_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
) -> AuditLog:
    """Persist an :class:`AuditLog` row in the current transaction."""

    log = AuditLog(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        owner_user_id=owner_user_id,
        actor_user_id=actor_user_id,
        details=details or {},
    )
    session.add(log)
    return log


def record_organization_audit_log(
    session: Session,
    *,
    organization_id: str,
    action: str,
    actor_user_id: Optional[str],
    details: Optional[Dict[str, Any]] = None,
) -> AuditLog:
    """Record an organization audit log entry with common metadata."""

    return record_audit_log(
        session,
        entity_type="organization",
        entity_id=organization_id,
        action=action,
        owner_user_id=organization_id,
        actor_user_id=actor_user_id,
        details=details,
    )


def record_organization_membership_audit_log(
    session: Session,
    *,
    organization_id: str,
    user_id: str,
    action: str,
    actor_user_id: Optional[str],
    details: Optional[Dict[str, Any]] = None,
) -> AuditLog:
    """Record an audit log entry for organization membership changes."""

    payload: Dict[str, Any] = {"organization_id": organization_id, "user_id": user_id}
    if details:
        payload.update(details)

    return record_audit_log(
        session,
        entity_type="organization_membership",
        entity_id=f"{organization_id}:{user_id}",
        action=action,
        owner_user_id=user_id,
        actor_user_id=actor_user_id,
        details=payload,
    )
