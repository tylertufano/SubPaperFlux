from typing import List
from sqlalchemy import func
from fastapi import APIRouter, Depends, status, HTTPException, Query
from sqlmodel import select

from ..audit import record_audit_log
from ..auth.oidc import get_current_user
from ..auth.rbac import can_manage_global_credentials
from ..schemas import Credential as CredentialSchema
from ..db import get_session
from ..models import Credential as CredentialModel
from ..security.crypto import encrypt_dict, decrypt_dict, is_encrypted
from ..security.csrf import csrf_protect
from ..util.quotas import enforce_user_quota


router = APIRouter()


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


@router.get("/", response_model=List[CredentialSchema])
def list_credentials(current_user=Depends(get_current_user), session=Depends(get_session), include_global: bool = Query(True)):
    user_id = current_user["sub"]
    stmt = select(CredentialModel).where(CredentialModel.owner_user_id == user_id)
    records = session.exec(stmt).all()
    if include_global:
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
        resp.append(CredentialSchema(id=rec.id, kind=rec.kind, data=_mask_credential(rec.kind, data), owner_user_id=rec.owner_user_id))
    return resp


@router.post("/", response_model=CredentialSchema, status_code=status.HTTP_201_CREATED, dependencies=[Depends(csrf_protect)])
def create_credential(body: CredentialSchema, current_user=Depends(get_current_user), session=Depends(get_session)):
    # Encrypt data before persisting, unless it already looks encrypted
    data = body.data or {}
    if not is_encrypted(data):
        data = encrypt_dict(data)
    owner = body.owner_user_id
    if owner is None and not can_manage_global_credentials(current_user):
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
    model = CredentialModel(kind=body.kind, data=data, owner_user_id=owner)
    session.add(model)
    record_audit_log(
        session,
        entity_type="credential",
        entity_id=model.id,
        action="create",
        owner_user_id=model.owner_user_id,
        actor_user_id=current_user["sub"],
        details={"kind": model.kind, "data_keys": sorted((body.data or {}).keys())},
    )
    session.commit()
    session.refresh(model)
    # Return masked plaintext view
    plain = decrypt_dict(model.data or {})
    return CredentialSchema(id=model.id, kind=model.kind, data=_mask_credential(model.kind, plain), owner_user_id=model.owner_user_id)


@router.delete("/{cred_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(csrf_protect)])
def delete_credential(cred_id: str, current_user=Depends(get_current_user), session=Depends(get_session)):
    model = session.get(CredentialModel, cred_id)
    if not model:
        raise HTTPException(status_code=404, detail="Not found")

    is_owner = model.owner_user_id == current_user["sub"]
    can_delete_global = model.owner_user_id is None and can_manage_global_credentials(current_user)
    if not (is_owner or can_delete_global):
        raise HTTPException(status_code=404, detail="Not found")
    record_audit_log(
        session,
        entity_type="credential",
        entity_id=model.id,
        action="delete",
        owner_user_id=model.owner_user_id,
        actor_user_id=current_user["sub"],
        details={"kind": model.kind},
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
    if model.owner_user_id not in (current_user["sub"], None):
        raise HTTPException(status_code=404, detail="Not found")
    plain = decrypt_dict(model.data or {})
    return CredentialSchema(id=model.id, kind=model.kind, data=_mask_credential(model.kind, plain), owner_user_id=model.owner_user_id)


@router.put("/{cred_id}", response_model=CredentialSchema, dependencies=[Depends(csrf_protect)])
def update_credential(cred_id: str, body: CredentialSchema, current_user=Depends(get_current_user), session=Depends(get_session)):
    model = session.get(CredentialModel, cred_id)
    if not model:
        raise HTTPException(status_code=404, detail="Not found")
    # Only owner can update; allow admin to update globals
    if model.owner_user_id not in (current_user["sub"], None):
        raise HTTPException(status_code=404, detail="Not found")
    incoming = body.data or {}
    previous_kind = model.kind
    if is_encrypted(incoming):
        enc = incoming
    else:
        existing_plain = decrypt_dict(model.data or {})
        merged_plain = dict(existing_plain)
        for k, v in incoming.items():
            merged_plain[k] = v
        enc = encrypt_dict(merged_plain)
    model.kind = body.kind or model.kind
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
        },
    )
    session.commit()
    session.refresh(model)
    plain = decrypt_dict(model.data or {})
    return CredentialSchema(id=model.id, kind=model.kind, data=_mask_credential(model.kind, plain), owner_user_id=model.owner_user_id)
