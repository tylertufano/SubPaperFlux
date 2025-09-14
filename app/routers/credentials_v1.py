from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import select

from ..auth.oidc import get_current_user
from ..db import get_session
from ..models import Credential
from ..schemas import CredentialsPage, Credential as CredentialSchema
from .credentials import _mask_credential


router = APIRouter(prefix="/v1/credentials", tags=["v1"])


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
    if include_global:
        records += session.exec(select(Credential).where(Credential.owner_user_id.is_(None))).all()
    if kind:
        records = [r for r in records if r.kind == kind]
    total = len(records)
    start = (page - 1) * size
    end = start + size
    rows = records[start:end]
    items = [
        CredentialSchema(id=r.id, kind=r.kind, data=_mask_credential(r.kind, {}), owner_user_id=r.owner_user_id)
        for r in rows
    ]
    has_next = (page * size) < total
    total_pages = int((total + size - 1) // size) if size else 1
    return CredentialsPage(items=items, total=total, page=page, size=size, has_next=has_next, total_pages=total_pages)
