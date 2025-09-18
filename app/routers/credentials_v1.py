from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlmodel import select

from ..audit import record_audit_log
from ..auth.oidc import get_current_user
from ..auth import (
    PERMISSION_READ_GLOBAL_CREDENTIALS,
    has_permission,
)
from ..config import is_user_mgmt_enforce_enabled
from ..db import get_session
from ..models import Credential
from ..schemas import CredentialsPage, Credential as CredentialSchema
from ..security.crypto import decrypt_dict
from ..util.quotas import enforce_user_quota
from .credentials import _mask_credential


router = APIRouter(prefix="/v1/credentials", tags=["v1"])


def _ensure_permission(session, current_user, permission: str) -> bool:
    allowed = has_permission(session, current_user, permission)
    if is_user_mgmt_enforce_enabled() and not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return allowed


@router.get("", response_model=CredentialsPage, summary="List credentials")
@router.get("/", response_model=CredentialsPage, summary="List credentials")
def list_credentials_v1(
    current_user=Depends(get_current_user),
    session=Depends(get_session),
    include_global: bool = Query(True),
    kind: Optional[str] = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
):
    user_id = current_user["sub"]
    records = session.exec(select(Credential).where(Credential.owner_user_id == user_id)).all()
    include_global_records = False
    if include_global:
        include_global_records = _ensure_permission(
            session,
            current_user,
            PERMISSION_READ_GLOBAL_CREDENTIALS,
        )
    if include_global_records:
        records += session.exec(select(Credential).where(Credential.owner_user_id.is_(None))).all()
    if is_user_mgmt_enforce_enabled():
        records = [
            r
            for r in records
            if r.owner_user_id == user_id
            or (r.owner_user_id is None and include_global_records)
        ]
    if kind:
        records = [r for r in records if r.kind == kind]
    total = len(records)
    start = (page - 1) * size
    end = start + size
    rows = records[start:end]
    items = [
        CredentialSchema(
            id=r.id,
            kind=r.kind,
            description=r.description,
            data=_mask_credential(r.kind, {}),
            owner_user_id=r.owner_user_id,
        )
        for r in rows
    ]
    has_next = (page * size) < total
    total_pages = int((total + size - 1) // size) if size else 1
    return CredentialsPage(items=items, total=total, page=page, size=size, has_next=has_next, total_pages=total_pages)


@router.post(
    "/{cred_id}/copy",
    response_model=CredentialSchema,
    status_code=status.HTTP_201_CREATED,
)
def copy_credential(
    cred_id: str,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    user_id = current_user["sub"]

    source = session.get(Credential, cred_id)
    if not source or source.owner_user_id is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    allowed = has_permission(session, current_user, PERMISSION_READ_GLOBAL_CREDENTIALS)
    if not allowed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    enforce_user_quota(
        session,
        user_id,
        quota_field="quota_credentials",
        resource_name="Credential",
        count_stmt=select(func.count())
        .select_from(Credential)
        .where(Credential.owner_user_id == user_id),
    )

    plain = decrypt_dict(source.data or {})
    cloned = Credential(
        kind=source.kind,
        description=source.description,
        data=dict(source.data or {}),
        owner_user_id=user_id,
    )
    session.add(cloned)

    record_audit_log(
        session,
        entity_type="credential",
        entity_id=cloned.id,
        action="copy",
        owner_user_id=cloned.owner_user_id,
        actor_user_id=user_id,
        details={
            "source_credential_id": source.id,
            "kind": cloned.kind,
            "description": cloned.description,
            "data_keys": sorted(plain.keys()),
        },
    )

    session.commit()
    session.refresh(cloned)

    return CredentialSchema(
        id=cloned.id,
        kind=cloned.kind,
        description=cloned.description,
        data=_mask_credential(cloned.kind, plain),
        owner_user_id=cloned.owner_user_id,
    )
