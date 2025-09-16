"""Versioned admin audit endpoints."""

from fastapi import APIRouter

from ..schemas import AuditLogsPage
from .admin import list_audit_logs


router = APIRouter(prefix="/v1/admin/audit", tags=["v1", "admin"])

router.add_api_route(
    "",
    list_audit_logs,
    response_model=AuditLogsPage,
    methods=["GET"],
    summary="List audit log entries",
)
