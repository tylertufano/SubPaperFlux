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
