from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlmodel import select

from ..audit import record_audit_log
from ..auth.oidc import get_current_user
from ..auth import (
    PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
    PERMISSION_READ_GLOBAL_CREDENTIALS,
    has_permission,
)
from ..config import is_user_mgmt_enforce_enabled
from ..db import get_session
from ..models import Credential as CredentialModel, SiteConfig as SiteConfigModel
from ..schemas import CredentialsPage, Credential as CredentialSchema
from ..security.crypto import decrypt_dict, encrypt_dict, is_encrypted
from ..security.csrf import csrf_protect
from ..integrations.instapaper import get_instapaper_tokens
from ..util.quotas import enforce_user_quota
from .credentials import (
    InstapaperLoginRequest,
    _ensure_global_kind,
    _get_db_credential_by_kind,
    _include_global_query,
    _load_instapaper_app_creds_from_file,
    _map_instapaper_error,
    _mask_credential,
    _validate_site_config_assignment,
)


router = APIRouter(prefix="/v1/credentials", tags=["v1"])


def _ensure_permission(session, current_user, permission: str) -> bool:
    allowed = has_permission(session, current_user, permission)
    if is_user_mgmt_enforce_enabled() and not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return allowed


@router.post(
    "",
    response_model=CredentialSchema,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(csrf_protect)],
    summary="Create credential",
)
def create_credential_v1(
    body: CredentialSchema,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    data = body.data or {}
    if not is_encrypted(data):
        data = encrypt_dict(data)

    description = body.description.strip()
    owner = body.owner_user_id
    if isinstance(owner, str):
        owner = owner.strip()
        if not owner:
            owner = None
    site_config_id = body.site_config_id
    if isinstance(site_config_id, str):
        site_config_id = site_config_id.strip()
        if not site_config_id:
            site_config_id = None

    site_config_record: Optional[SiteConfigModel] = None

    if body.kind == "site_login" and not site_config_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="site_login credentials require a site_config_id",
        )

    if body.kind == "site_login":
        site_config_record = _validate_site_config_assignment(
            session,
            current_user,
            site_config_id=site_config_id,
            credential_owner_id=owner,
        )
        if site_config_record is not None:
            owner = site_config_record.owner_user_id
            site_config_id = site_config_record.id
    elif owner is None:
        allowed_global = has_permission(
            session,
            current_user,
            PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
            owner_id=None,
        )
        if not allowed_global:
            owner = current_user["sub"]
        else:
            _ensure_global_kind(body.kind)

    if owner is not None:
        enforce_user_quota(
            session,
            owner,
            quota_field="quota_credentials",
            resource_name="Credential",
            count_stmt=select(func.count())
            .select_from(CredentialModel)
            .where(CredentialModel.owner_user_id == owner),
        )

    model = CredentialModel(
        kind=body.kind,
        description=description,
        data=data,
        owner_user_id=owner,
        site_config_id=site_config_id,
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
            "site_config_id": model.site_config_id,
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
        site_config_id=model.site_config_id,
    )


@router.post(
    "/instapaper/login",
    response_model=CredentialSchema,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(csrf_protect)],
    summary="Create Instapaper credential via login",
)
def create_instapaper_credential_from_login_v1(
    body: InstapaperLoginRequest,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    user_id = current_user["sub"]
    description = body.description.strip()
    username = body.username.strip()

    owner: Optional[str] = user_id
    if body.scope_global:
        _ensure_permission(
            session,
            current_user,
            PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
        )
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Instapaper credentials cannot be global",
        )

    if owner is not None:
        enforce_user_quota(
            session,
            owner,
            quota_field="quota_credentials",
            resource_name="Credential",
            count_stmt=select(func.count())
            .select_from(CredentialModel)
            .where(CredentialModel.owner_user_id == owner),
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
        site_config_id=model.site_config_id,
    )


@router.get("", response_model=CredentialsPage, summary="List credentials")
def list_credentials_v1(
    current_user=Depends(get_current_user),
    session=Depends(get_session),
    include_global: bool = Depends(_include_global_query),
    kind: Optional[str] = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
):
    user_id = current_user["sub"]
    records = session.exec(
        select(CredentialModel).where(CredentialModel.owner_user_id == user_id)
    ).all()
    include_global_records = False
    if include_global:
        include_global_records = _ensure_permission(
            session,
            current_user,
            PERMISSION_READ_GLOBAL_CREDENTIALS,
        )
    if include_global_records:
        records += session.exec(
            select(CredentialModel).where(CredentialModel.owner_user_id.is_(None))
        ).all()
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
            site_config_id=r.site_config_id,
        )
        for r in rows
    ]
    has_next = (page * size) < total
    total_pages = int((total + size - 1) // size) if size else 1
    return CredentialsPage(items=items, total=total, page=page, size=size, has_next=has_next, total_pages=total_pages)


@router.get(
    "/{cred_id}",
    response_model=CredentialSchema,
    summary="Get credential",
)
def get_credential_v1(
    cred_id: str,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    model = session.get(CredentialModel, cred_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

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
        site_config_id=model.site_config_id,
    )


@router.put(
    "/{cred_id}",
    response_model=CredentialSchema,
    dependencies=[Depends(csrf_protect)],
    summary="Update credential",
)
def update_credential_v1(
    cred_id: str,
    body: CredentialSchema,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    model = session.get(CredentialModel, cred_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    if model.owner_user_id is None:
        _ensure_global_kind(model.kind)
        allowed_global = has_permission(
            session,
            current_user,
            PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
            owner_id=None,
        )
        if not allowed_global:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        incoming_kind = body.kind or model.kind
        _ensure_global_kind(incoming_kind)
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
    new_kind = body.kind or model.kind
    new_site_config_id = (
        body.site_config_id if body.site_config_id is not None else model.site_config_id
    )

    if new_kind == "site_login" and not new_site_config_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="site_login credentials require a site_config_id",
        )

    if new_kind == "site_login" and new_site_config_id:
        _validate_site_config_assignment(
            session,
            current_user,
            site_config_id=new_site_config_id,
            credential_owner_id=model.owner_user_id,
        )

    if is_encrypted(incoming):
        enc = incoming
    else:
        existing_plain = decrypt_dict(model.data or {})
        merged_plain = dict(existing_plain)
        for key, value in incoming.items():
            merged_plain[key] = value
        enc = encrypt_dict(merged_plain)

    model.kind = new_kind
    model.description = body.description.strip()
    model.data = enc
    model.site_config_id = new_site_config_id

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
        site_config_id=model.site_config_id,
    )


@router.delete(
    "/{cred_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(csrf_protect)],
    summary="Delete credential",
)
def delete_credential_v1(
    cred_id: str,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    model = session.get(CredentialModel, cred_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    if model.owner_user_id is None:
        _ensure_global_kind(model.kind)
        allowed_global = has_permission(
            session,
            current_user,
            PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
            owner_id=None,
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

    source = session.get(CredentialModel, cred_id)
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
        .select_from(CredentialModel)
        .where(CredentialModel.owner_user_id == user_id),
    )

    plain = decrypt_dict(source.data or {})
    cloned = CredentialModel(
        kind=source.kind,
        description=source.description,
        data=dict(source.data or {}),
        owner_user_id=user_id,
        site_config_id=source.site_config_id,
    )

    if cloned.kind == "site_login":
        if not cloned.site_config_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="site_login credentials require a site_config_id",
            )
        _validate_site_config_assignment(
            session,
            current_user,
            site_config_id=cloned.site_config_id,
            credential_owner_id=user_id,
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
        site_config_id=cloned.site_config_id,
    )
