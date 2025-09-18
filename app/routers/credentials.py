import json
import logging
from pathlib import Path
from typing import List, Optional

from sqlalchemy import func
from fastapi import APIRouter, Depends, status, HTTPException, Query
from sqlmodel import select

from pydantic import BaseModel, constr

from ..audit import record_audit_log
from ..auth.oidc import get_current_user
from ..auth.permissions import (
    PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
    PERMISSION_READ_GLOBAL_CREDENTIALS,
    has_permission,
)
from ..schemas import Credential as CredentialSchema
from ..db import get_session
from ..models import Credential as CredentialModel
from ..security.crypto import encrypt_dict, decrypt_dict, is_encrypted
from ..security.csrf import csrf_protect
from ..util.quotas import enforce_user_quota
from ..integrations.instapaper import (
    InstapaperTokenResponse,
    get_instapaper_tokens,
)
from ..jobs.util_subpaperflux import _get_db_credential_by_kind, resolve_config_dir
from ..config import is_user_mgmt_enforce_enabled


router = APIRouter()


def _ensure_permission(session, current_user, permission: str, *, owner_id: Optional[str] = None) -> bool:
    allowed = has_permission(session, current_user, permission, owner_id=owner_id)
    if is_user_mgmt_enforce_enabled() and not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return allowed


def _mask_value(value: str) -> str:
    if not value:
        return value
    if len(value) <= 4:
        return "****"
    return value[:2] + "***" + value[-2:]


def _mask_credential(kind: str, data: dict) -> dict:
    masked = dict(data)
    sensitive_keys = {
        "site_login": ["password"],
        "miniflux": ["api_key"],
        "instapaper": ["oauth_token", "oauth_token_secret"],
        "instapaper_app": ["consumer_secret"],
    }
    for key in sensitive_keys.get(kind, []):
        if key in masked and isinstance(masked[key], str):
            masked[key] = _mask_value(masked[key])
    return masked


class InstapaperLoginRequest(BaseModel):
    description: constr(strip_whitespace=True, min_length=1, max_length=200)
    username: constr(strip_whitespace=True, min_length=1)
    password: constr(min_length=1)
    scope_global: bool = False


def _load_instapaper_app_creds_from_file(config_dir: Optional[str] = None) -> dict:
    resolved_dir = resolve_config_dir(config_dir)
    path = Path(resolved_dir) / "instapaper_app_creds.json"
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as fp:
            return json.load(fp)
    except (OSError, json.JSONDecodeError):
        logging.exception("Failed to load instapaper_app_creds.json from %s", path)
        return {}


def _map_instapaper_error(result: InstapaperTokenResponse) -> HTTPException:
    status_code = result.status_code
    if status_code is not None and 400 <= status_code < 500:
        return HTTPException(status_code=400, detail="Invalid Instapaper username or password")
    return HTTPException(status_code=502, detail="Instapaper API error")


@router.get("/", response_model=List[CredentialSchema])
def list_credentials(current_user=Depends(get_current_user), session=Depends(get_session), include_global: bool = Query(True)):
    user_id = current_user["sub"]
    stmt = select(CredentialModel).where(CredentialModel.owner_user_id == user_id)
    records = session.exec(stmt).all()
    include_global_records = False
    if include_global:
        include_global_records = _ensure_permission(
            session,
            current_user,
            PERMISSION_READ_GLOBAL_CREDENTIALS,
        )
    if include_global_records:
        stmt2 = select(CredentialModel).where(CredentialModel.owner_user_id.is_(None))
        records += session.exec(stmt2).all()
    # Build masked response without mutating DB objects
    resp = []
    for rec in records:
        data = rec.data or {}
        try:
            data = decrypt_dict(data)
        except Exception:
            # If decryption fails, return a placeholder
            data = {"error": "cannot decrypt"}
        resp.append(
            CredentialSchema(
                id=rec.id,
                kind=rec.kind,
                description=rec.description,
                data=_mask_credential(rec.kind, data),
                owner_user_id=rec.owner_user_id,
            )
        )
    return resp


@router.post("/", response_model=CredentialSchema, status_code=status.HTTP_201_CREATED, dependencies=[Depends(csrf_protect)])
def create_credential(body: CredentialSchema, current_user=Depends(get_current_user), session=Depends(get_session)):
    # Encrypt data before persisting, unless it already looks encrypted
    data = body.data or {}
    if not is_encrypted(data):
        data = encrypt_dict(data)
    description = body.description.strip()
    owner = body.owner_user_id
    if owner is None:
        allowed_global = _ensure_permission(
            session,
            current_user,
            PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
        )
        if not allowed_global:
            owner = current_user["sub"]
    if owner is not None:
        enforce_user_quota(
            session,
            owner,
            quota_field="quota_credentials",
            resource_name="Credential",
            count_stmt=select(func.count()).select_from(CredentialModel).where(
                CredentialModel.owner_user_id == owner
            ),
        )
    model = CredentialModel(
        kind=body.kind,
        description=description,
        data=data,
        owner_user_id=owner,
    )
    session.add(model)
    record_audit_log(
        session,
        entity_type="credential",
        entity_id=model.id,
        action="create",
        owner_user_id=model.owner_user_id,
        actor_user_id=current_user["sub"],
        details={
            "kind": model.kind,
            "description": model.description,
            "data_keys": sorted((body.data or {}).keys()),
        },
    )
    session.commit()
    session.refresh(model)
    # Return masked plaintext view
    plain = decrypt_dict(model.data or {})
    return CredentialSchema(
        id=model.id,
        kind=model.kind,
        description=model.description,
        data=_mask_credential(model.kind, plain),
        owner_user_id=model.owner_user_id,
    )


@router.post(
    "/instapaper/login",
    response_model=CredentialSchema,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(csrf_protect)],
)
def create_instapaper_credential_from_login(
    body: InstapaperLoginRequest,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    user_id = current_user["sub"]
    description = body.description.strip()
    username = body.username.strip()

    owner: Optional[str] = user_id
    if body.scope_global:
        allowed_global = _ensure_permission(
            session,
            current_user,
            PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
        )
        if allowed_global:
            owner = None

    if owner is not None:
        enforce_user_quota(
            session,
            owner,
            quota_field="quota_credentials",
            resource_name="Credential",
            count_stmt=select(func.count()).select_from(CredentialModel).where(
                CredentialModel.owner_user_id == owner
            ),
        )

    app_creds = _get_db_credential_by_kind("instapaper_app", user_id) or _load_instapaper_app_creds_from_file()
    consumer_key = (app_creds or {}).get("consumer_key")
    consumer_secret = (app_creds or {}).get("consumer_secret")
    if not consumer_key or not consumer_secret:
        raise HTTPException(status_code=400, detail="Instapaper app credentials are not configured")

    token_result = get_instapaper_tokens(consumer_key, consumer_secret, username, body.password)
    if not token_result.success:
        raise _map_instapaper_error(token_result)

    plain = {
        "username": username,
        "oauth_token": token_result.oauth_token,
        "oauth_token_secret": token_result.oauth_token_secret,
    }
    encrypted = encrypt_dict(plain)

    model = CredentialModel(
        kind="instapaper",
        description=description,
        data=encrypted,
        owner_user_id=owner,
    )
    session.add(model)
    record_audit_log(
        session,
        entity_type="credential",
        entity_id=model.id,
        action="create",
        owner_user_id=model.owner_user_id,
        actor_user_id=user_id,
        details={
            "kind": model.kind,
            "description": model.description,
            "scope_global": model.owner_user_id is None,
            "data_keys": sorted(plain.keys()),
        },
    )
    session.commit()
    session.refresh(model)

    return CredentialSchema(
        id=model.id,
        kind=model.kind,
        description=model.description,
        data=_mask_credential(model.kind, plain),
        owner_user_id=model.owner_user_id,
    )


@router.delete("/{cred_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(csrf_protect)])
def delete_credential(cred_id: str, current_user=Depends(get_current_user), session=Depends(get_session)):
    model = session.get(CredentialModel, cred_id)
    if not model:
        raise HTTPException(status_code=404, detail="Not found")

    if model.owner_user_id is None:
        allowed_global = _ensure_permission(
            session,
            current_user,
            PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
        )
        if not allowed_global:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    elif model.owner_user_id != current_user["sub"]:
        allowed_cross = has_permission(
            session,
            current_user,
            PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
            owner_id=model.owner_user_id,
        )
        if not allowed_cross:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    record_audit_log(
        session,
        entity_type="credential",
        entity_id=model.id,
        action="delete",
        owner_user_id=model.owner_user_id,
        actor_user_id=current_user["sub"],
        details={"kind": model.kind, "description": model.description},
    )
    session.delete(model)
    session.commit()
    return None


@router.get("/{cred_id}", response_model=CredentialSchema)
def get_credential(cred_id: str, current_user=Depends(get_current_user), session=Depends(get_session)):
    model = session.get(CredentialModel, cred_id)
    if not model:
        raise HTTPException(status_code=404, detail="Not found")
    # Allow if owner is user, or record is global (owner_user_id None)
    if model.owner_user_id is None:
        allowed_global = _ensure_permission(
            session,
            current_user,
            PERMISSION_READ_GLOBAL_CREDENTIALS,
        )
        if not allowed_global:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    elif model.owner_user_id != current_user["sub"]:
        allowed_cross = has_permission(
            session,
            current_user,
            PERMISSION_READ_GLOBAL_CREDENTIALS,
            owner_id=model.owner_user_id,
        )
        if not allowed_cross:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    plain = decrypt_dict(model.data or {})
    return CredentialSchema(
        id=model.id,
        kind=model.kind,
        description=model.description,
        data=_mask_credential(model.kind, plain),
        owner_user_id=model.owner_user_id,
    )


@router.put("/{cred_id}", response_model=CredentialSchema, dependencies=[Depends(csrf_protect)])
def update_credential(cred_id: str, body: CredentialSchema, current_user=Depends(get_current_user), session=Depends(get_session)):
    model = session.get(CredentialModel, cred_id)
    if not model:
        raise HTTPException(status_code=404, detail="Not found")
    # Only owner can update; allow admin to update globals
    if model.owner_user_id is None:
        allowed_global = _ensure_permission(
            session,
            current_user,
            PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
        )
        if not allowed_global:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    elif model.owner_user_id != current_user["sub"]:
        allowed_cross = has_permission(
            session,
            current_user,
            PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
            owner_id=model.owner_user_id,
        )
        if not allowed_cross:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    incoming = body.data or {}
    previous_kind = model.kind
    previous_description = model.description
    if is_encrypted(incoming):
        enc = incoming
    else:
        existing_plain = decrypt_dict(model.data or {})
        merged_plain = dict(existing_plain)
        for k, v in incoming.items():
            merged_plain[k] = v
        enc = encrypt_dict(merged_plain)
    model.kind = body.kind or model.kind
    model.description = body.description.strip()
    model.data = enc
    session.add(model)
    record_audit_log(
        session,
        entity_type="credential",
        entity_id=model.id,
        action="update",
        owner_user_id=model.owner_user_id,
        actor_user_id=current_user["sub"],
        details={
            "kind": model.kind,
            "updated_fields": sorted(incoming.keys()),
            "kind_changed": model.kind != previous_kind,
            "description_changed": model.description != previous_description,
            "description": model.description,
        },
    )
    session.commit()
    session.refresh(model)
    plain = decrypt_dict(model.data or {})
    return CredentialSchema(
        id=model.id,
        kind=model.kind,
        description=model.description,
        data=_mask_credential(model.kind, plain),
        owner_user_id=model.owner_user_id,
    )
