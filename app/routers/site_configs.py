from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlmodel import select

from ..audit import record_audit_log
from ..auth.oidc import get_current_user
from ..auth.rbac import can_manage_global_site_configs
from ..schemas import SiteConfig as SiteConfigSchema
from ..db import get_session
from ..security.csrf import csrf_protect
from ..models import SiteConfig as SiteConfigModel


router = APIRouter()


@router.get("/", response_model=List[SiteConfigSchema])
def list_site_configs(current_user=Depends(get_current_user), session=Depends(get_session), include_global: bool = Query(True)):
    user_id = current_user["sub"]
    stmt = select(SiteConfigModel).where(SiteConfigModel.owner_user_id == user_id)
    results = session.exec(stmt).all()
    if include_global:
        stmt2 = select(SiteConfigModel).where(SiteConfigModel.owner_user_id.is_(None))
        results += session.exec(stmt2).all()
    return results


@router.post("/", response_model=SiteConfigSchema, status_code=status.HTTP_201_CREATED, dependencies=[Depends(csrf_protect)])
def create_site_config(body: SiteConfigSchema, current_user=Depends(get_current_user), session=Depends(get_session)):
    payload = body.model_dump(mode="json")
    payload.pop("id", None)
    model = SiteConfigModel(**payload)
    # Only admins may create global configs (owner_user_id None)
    if model.owner_user_id is None and not can_manage_global_site_configs(current_user):
        model.owner_user_id = current_user["sub"]
    session.add(model)
    record_audit_log(
        session,
        entity_type="setting",
        entity_id=model.id,
        action="create",
        owner_user_id=model.owner_user_id,
        actor_user_id=current_user["sub"],
        details={
            "name": model.name,
            "site_url": model.site_url,
            "cookies_to_store": list(model.cookies_to_store or []),
        },
    )
    session.commit()
    session.refresh(model)
    return model


@router.get("/{config_id}", response_model=SiteConfigSchema)
def get_site_config(config_id: str, current_user=Depends(get_current_user), session=Depends(get_session)):
    model = session.get(SiteConfigModel, config_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if model.owner_user_id and model.owner_user_id != current_user["sub"]:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return model


@router.put("/{config_id}", response_model=SiteConfigSchema, dependencies=[Depends(csrf_protect)])
def update_site_config(config_id: str, body: SiteConfigSchema, current_user=Depends(get_current_user), session=Depends(get_session)):
    model = session.get(SiteConfigModel, config_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    # Non-admins cannot modify global configs
    if model.owner_user_id is None and not can_manage_global_site_configs(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    if model.owner_user_id and model.owner_user_id != current_user["sub"]:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    update_payload = body.model_dump(exclude_unset=True, mode="json")
    update_payload.pop("id", None)
    original = model.model_dump(mode="json")
    for k, v in update_payload.items():
        setattr(model, k, v)
    session.add(model)
    record_audit_log(
        session,
        entity_type="setting",
        entity_id=model.id,
        action="update",
        owner_user_id=model.owner_user_id,
        actor_user_id=current_user["sub"],
        details={
            "name": model.name,
            "site_url": model.site_url,
            "updated_fields": sorted(update_payload.keys()),
            "owner_changed": original.get("owner_user_id") != model.owner_user_id,
        },
    )
    session.commit()
    session.refresh(model)
    return model


@router.delete("/{config_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(csrf_protect)])
def delete_site_config(config_id: str, current_user=Depends(get_current_user), session=Depends(get_session)):
    model = session.get(SiteConfigModel, config_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    # Non-admins cannot delete global configs
    if model.owner_user_id is None and not can_manage_global_site_configs(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    if model.owner_user_id and model.owner_user_id != current_user["sub"]:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    record_audit_log(
        session,
        entity_type="setting",
        entity_id=model.id,
        action="delete",
        owner_user_id=model.owner_user_id,
        actor_user_id=current_user["sub"],
        details={"name": model.name, "site_url": model.site_url},
    )
    session.delete(model)
    session.commit()
    return None
