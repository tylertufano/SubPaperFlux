"""API token management for the authenticated user."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone
from typing import Iterable, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, status
from sqlalchemy import func
from sqlmodel import Session, select

from ..audit import record_audit_log
from ..auth.oidc import get_current_user
from ..auth.users import ensure_user_from_identity
from ..db import get_session
from ..models import ApiToken, User
from ..schemas import ApiTokenCreate, ApiTokenOut, ApiTokenWithSecret, ApiTokensPage


router = APIRouter(prefix="/v1/me/tokens", tags=["v1", "me"])


def _require_user_id(current_user) -> str:
    user_id = current_user.get("sub") if isinstance(current_user, dict) else None
    if not user_id:
        raise HTTPException(status_code=400, detail="Missing user identifier")
    return user_id


def _normalize_scopes(scopes: Optional[Iterable[str]]) -> List[str]:
    if not scopes:
        return []
    normalized: List[str] = []
    for scope in scopes:
        if scope is None:
            continue
        value = str(scope).strip()
        if not value:
            continue
        normalized.append(value)
    return sorted(set(normalized))


def _normalize_expires_at(expires_at: Optional[datetime]) -> Optional[datetime]:
    if expires_at is None:
        return None
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    expires_at = expires_at.astimezone(timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="expires_at must be in the future")
    return expires_at


def _generate_token_pair(session: Session) -> tuple[str, str]:
    for _ in range(5):
        raw = secrets.token_urlsafe(32)
        hashed = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        exists = session.exec(select(ApiToken).where(ApiToken.token_hash == hashed)).first()
        if not exists:
            return raw, hashed
    raise HTTPException(status_code=500, detail="Unable to generate unique token")


def _ensure_user(session: Session, current_user) -> User:
    _require_user_id(current_user)
    try:
        user, _, _ = ensure_user_from_identity(session, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return user


def _serialize_token(token: ApiToken) -> ApiTokenOut:
    scopes = list(token.scopes or [])
    return ApiTokenOut(
        id=token.id,
        name=token.name,
        description=token.description,
        scopes=scopes,
        created_at=token.created_at,
        updated_at=token.updated_at,
        last_used_at=token.last_used_at,
        expires_at=token.expires_at,
        revoked_at=token.revoked_at,
    )


@router.get("", response_model=ApiTokensPage, summary="List API tokens")
def list_tokens(
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    include_revoked: bool = Query(False),
):
    user_id = _require_user_id(current_user)
    filters = [ApiToken.user_id == user_id]
    if not include_revoked:
        filters.append(ApiToken.revoked_at.is_(None))

    count_stmt = select(func.count()).select_from(ApiToken).where(*filters)
    total = int(session.exec(count_stmt).one() or 0)

    offset = (page - 1) * size
    stmt = (
        select(ApiToken)
        .where(*filters)
        .order_by(ApiToken.created_at.desc())
        .offset(offset)
        .limit(size)
    )
    rows = session.exec(stmt).all()
    items = [_serialize_token(row) for row in rows]

    has_next = (page * size) < total
    total_pages = int((total + size - 1) // size) if size else 1
    return ApiTokensPage(
        items=items,
        total=total,
        page=page,
        size=size,
        has_next=has_next,
        total_pages=total_pages,
    )


@router.get("/{token_id}", response_model=ApiTokenOut, summary="Get API token metadata")
def get_token(
    token_id: str = Path(..., min_length=1),
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
):
    user_id = _require_user_id(current_user)
    token = session.get(ApiToken, token_id)
    if not token or token.user_id != user_id:
        raise HTTPException(status_code=404, detail="Token not found")
    return _serialize_token(token)


@router.post(
    "",
    response_model=ApiTokenWithSecret,
    status_code=status.HTTP_201_CREATED,
    summary="Create an API token",
)
def create_token(
    payload: ApiTokenCreate = Body(...),
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
):
    user = _ensure_user(session, current_user)
    user_id = user.id

    existing = session.exec(
        select(ApiToken).where(ApiToken.user_id == user_id, ApiToken.name == payload.name)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Token name already exists")

    scopes = _normalize_scopes(payload.scopes)
    expires_at = _normalize_expires_at(payload.expires_at)
    raw_token, token_hash = _generate_token_pair(session)

    token = ApiToken(
        user_id=user_id,
        name=payload.name,
        description=payload.description,
        token_hash=token_hash,
        scopes=scopes,
        expires_at=expires_at,
    )
    session.add(token)

    record_audit_log(
        session,
        entity_type="api_token",
        entity_id=token.id,
        action="create",
        owner_user_id=user_id,
        actor_user_id=user_id,
        details={"name": token.name, "scopes": scopes},
    )
    session.commit()
    session.refresh(token)

    token_out = _serialize_token(token)
    return ApiTokenWithSecret(**token_out.model_dump(), token=raw_token)


@router.delete(
    "/{token_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke an API token",
)
def revoke_token(
    token_id: str = Path(..., min_length=1),
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
):
    user_id = _require_user_id(current_user)
    token = session.get(ApiToken, token_id)
    if not token or token.user_id != user_id:
        raise HTTPException(status_code=404, detail="Token not found")

    if token.revoked_at is None:
        now = datetime.now(timezone.utc)
        token.revoked_at = now
        token.updated_at = now
        record_audit_log(
            session,
            entity_type="api_token",
            entity_id=token.id,
            action="revoke",
            owner_user_id=user_id,
            actor_user_id=user_id,
            details={"name": token.name},
        )
    session.add(token)
    session.commit()

