from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import TypeAdapter
from sqlalchemy import func
from sqlmodel import select

from ..audit import record_audit_log
from ..auth.oidc import get_current_user
from ..db import get_session
from ..models import SiteConfig as SiteConfigModel, SiteLoginType
from ..schemas import SiteConfig as SiteConfigSchema
from ..security.csrf import csrf_protect
from ..util.quotas import enforce_user_quota


_site_config_adapter = TypeAdapter(SiteConfigSchema)


def _login_type_value(value: SiteLoginType | str) -> str:
    if isinstance(value, SiteLoginType):
        return value.value
    return SiteLoginType(value).value


def _normalize_login_payload(
    login_type: Optional[str | SiteLoginType],
    selenium_config: Optional[Dict[str, object]],
    api_config: Optional[Dict[str, object]],
) -> Tuple[SiteLoginType, Optional[Dict[str, object]], Optional[Dict[str, object]]]:
    if isinstance(login_type, SiteLoginType):
        login_type_value = login_type
    else:
        try:
            login_type_value = SiteLoginType(login_type or "")
        except ValueError as exc:  # pragma: no cover - defensive branch
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Unsupported login_type",
            ) from exc

    if login_type_value == SiteLoginType.SELENIUM:
        config = dict(selenium_config or {})
        required = ["username_selector", "password_selector", "login_button_selector"]
        missing = [key for key in required if not config.get(key)]
        if missing:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"selenium_config missing required fields: {', '.join(missing)}",
            )
        cookies = config.get("cookies_to_store")
        if cookies is not None and not isinstance(cookies, list):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="selenium_config.cookies_to_store must be a list",
            )
        config["cookies_to_store"] = list(cookies or [])
        return login_type_value, config, None

    if login_type_value == SiteLoginType.API:
        config = dict(api_config or {})
        endpoint = config.get("endpoint")
        method = config.get("method")
        if not endpoint or not method:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="api_config requires endpoint and method",
            )
        headers = config.get("headers")
        if headers is not None and not isinstance(headers, dict):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="api_config.headers must be an object",
            )
        cookies = config.get("cookies")
        if cookies is not None and not isinstance(cookies, dict):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="api_config.cookies must be an object",
            )
        return login_type_value, None, config

    raise HTTPException(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="Unsupported login_type",
    )


def _serialize_site_config(model: SiteConfigModel) -> SiteConfigSchema:
    payload = model.model_dump(mode="json")
    payload["success_text_class"] = payload.get("success_text_class") or ""
    payload["expected_success_text"] = payload.get("expected_success_text") or ""
    payload["required_cookies"] = list(payload.get("required_cookies") or [])
    return _site_config_adapter.validate_python(payload)


def _summarize_login_payload(
    login_type: SiteLoginType,
    selenium_config: Optional[Dict[str, object]],
    api_config: Optional[Dict[str, object]],
) -> Dict[str, object]:
    if login_type == SiteLoginType.SELENIUM:
        selenium = selenium_config or {}
        return {
            "login_type": _login_type_value(login_type),
            "selectors": {
                key: selenium.get(key)
                for key in (
                    "username_selector",
                    "password_selector",
                    "login_button_selector",
                    "post_login_selector",
                )
            },
            "cookies_to_store_count": len(selenium.get("cookies_to_store") or []),
        }

    api = api_config or {}
    return {
        "login_type": _login_type_value(login_type),
        "endpoint": api.get("endpoint"),
        "method": api.get("method"),
        "has_headers": bool(api.get("headers")),
        "has_body": bool(api.get("body")),
        "cookies_to_store": list((api.get("cookies") or {}).keys()),
    }
router = APIRouter()


@router.get("/", response_model=List[SiteConfigSchema])
def list_site_configs(
    current_user=Depends(get_current_user), session=Depends(get_session)
):
    user_id = current_user["sub"]
    stmt = select(SiteConfigModel).where(SiteConfigModel.owner_user_id == user_id)
    results = session.exec(stmt).all()
    return [_serialize_site_config(model) for model in results]


@router.post("/", response_model=SiteConfigSchema, status_code=status.HTTP_201_CREATED, dependencies=[Depends(csrf_protect)])
def create_site_config(body: SiteConfigSchema, current_user=Depends(get_current_user), session=Depends(get_session)):
    payload = body.model_dump(mode="json")
    payload.pop("id", None)
    payload["owner_user_id"] = current_user["sub"]
    login_type, selenium_config, api_config = _normalize_login_payload(
        payload.get("login_type"),
        payload.get("selenium_config"),
        payload.get("api_config"),
    )
    payload.pop("login_type", None)
    payload.pop("selenium_config", None)
    payload.pop("api_config", None)
    payload["success_text_class"] = payload.get("success_text_class") or ""
    payload["expected_success_text"] = payload.get("expected_success_text") or ""
    payload["required_cookies"] = list(payload.get("required_cookies") or [])
    model = SiteConfigModel(
        **payload,
        login_type=login_type,
        selenium_config=selenium_config,
        api_config=api_config,
    )
    enforce_user_quota(
        session,
        model.owner_user_id,
        quota_field="quota_site_configs",
        resource_name="Site config",
        count_stmt=select(func.count()).select_from(SiteConfigModel).where(
            SiteConfigModel.owner_user_id == model.owner_user_id
        ),
    )
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
            "login_payload": _summarize_login_payload(
                model.login_type, model.selenium_config, model.api_config
            ),
        },
    )
    session.commit()
    session.refresh(model)
    return _serialize_site_config(model)


@router.get("/{config_id}", response_model=SiteConfigSchema)
def get_site_config(config_id: str, current_user=Depends(get_current_user), session=Depends(get_session)):
    model = session.get(SiteConfigModel, config_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if model.owner_user_id != current_user["sub"]:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return _serialize_site_config(model)


@router.put("/{config_id}", response_model=SiteConfigSchema, dependencies=[Depends(csrf_protect)])
def update_site_config(config_id: str, body: SiteConfigSchema, current_user=Depends(get_current_user), session=Depends(get_session)):
    model = session.get(SiteConfigModel, config_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if model.owner_user_id != current_user["sub"]:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    update_payload = body.model_dump(exclude_unset=True, mode="json")
    update_payload.pop("id", None)
    original = model.model_dump(mode="json")

    login_type, selenium_config, api_config = _normalize_login_payload(
        update_payload.get("login_type", model.login_type),
        update_payload.get("selenium_config", model.selenium_config),
        update_payload.get("api_config", model.api_config),
    )

    changed_fields = set(update_payload.keys())

    if login_type != model.login_type:
        changed_fields.add("login_type")
    if selenium_config != (model.selenium_config or None):
        changed_fields.add("selenium_config")
    if api_config != (model.api_config or None):
        changed_fields.add("api_config")

    for field in (
        "name",
        "site_url",
        "success_text_class",
        "expected_success_text",
        "required_cookies",
    ):
        if field in update_payload:
            value = update_payload[field]
            if field == "required_cookies":
                value = list(value or [])
            setattr(model, field, value)

    model.login_type = login_type
    model.selenium_config = selenium_config
    model.api_config = api_config
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
            "updated_fields": sorted(changed_fields),
            "login_payload": _summarize_login_payload(
                model.login_type, model.selenium_config, model.api_config
            ),
        },
    )
    session.commit()
    session.refresh(model)
    return _serialize_site_config(model)


@router.delete("/{config_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(csrf_protect)])
def delete_site_config(config_id: str, current_user=Depends(get_current_user), session=Depends(get_session)):
    model = session.get(SiteConfigModel, config_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if model.owner_user_id != current_user["sub"]:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    record_audit_log(
        session,
        entity_type="setting",
        entity_id=model.id,
        action="delete",
        owner_user_id=model.owner_user_id,
        actor_user_id=current_user["sub"],
        details={
            "name": model.name,
            "site_url": model.site_url,
            "login_type": _login_type_value(model.login_type),
        },
    )
    session.delete(model)
    session.commit()
    return None
