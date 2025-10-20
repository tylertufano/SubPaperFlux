from typing import Any, Dict, List, Optional, Tuple

import httpx
import requests
from bs4 import BeautifulSoup
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import TypeAdapter
from sqlalchemy import func
from sqlmodel import select

from ..audit import record_audit_log
from ..auth.oidc import get_current_user
from ..db import get_session
from ..models import SiteConfig as SiteConfigModel, SiteLoginType
from ..schemas import SiteConfig as SiteConfigSchema
from ..schemas import SiteConfigOut, SiteConfigsPage
from ..security.csrf import csrf_protect
from ..services.subpaperflux_login import _execute_api_step, _extract_json_pointer
from ..util.quotas import enforce_user_quota


router = APIRouter(prefix="/v1/site-configs", tags=["v1"])

_site_config_out_adapter = TypeAdapter(SiteConfigOut)


def _site_config_to_schema(model: SiteConfigModel) -> SiteConfigOut:
    return _site_config_out_adapter.validate_python(model.model_dump(mode="json"))


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
        cookies_to_store = config.get("cookies_to_store")
        if cookies_to_store is not None and not isinstance(cookies_to_store, list):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="api_config.cookies_to_store must be a list",
            )
        if cookies_to_store is not None:
            config["cookies_to_store"] = list(cookies_to_store or [])
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
    cookies_to_store = list(api.get("cookies_to_store") or [])
    if not cookies_to_store:
        cookies_to_store = list((api.get("cookies") or {}).keys())
    return {
        "login_type": _login_type_value(login_type),
        "endpoint": api.get("endpoint"),
        "method": api.get("method"),
        "has_headers": bool(api.get("headers")),
        "has_body": bool(api.get("body")),
        "cookies_to_store": cookies_to_store,
    }


def _serialize_cookie(cookie: Any) -> Dict[str, Any]:
    payload = {"name": cookie.name, "value": cookie.value}
    if getattr(cookie, "domain", None):
        payload["domain"] = cookie.domain
    if getattr(cookie, "path", None):
        payload["path"] = cookie.path
    if getattr(cookie, "expires", None) is not None:
        payload["expiry"] = cookie.expires
    if getattr(cookie, "secure", False):
        payload["secure"] = True
    rest = getattr(cookie, "_rest", {}) or {}
    if rest.get("HttpOnly") or rest.get("httponly"):
        payload["httpOnly"] = True
    return payload


def _test_api_site_config(sc: SiteConfigModel) -> Dict[str, Any]:
    api_config = dict(sc.api_config or {})
    if not api_config:
        return {
            "ok": False,
            "error": "missing_api_config",
            "login_type": SiteLoginType.API.value,
        }

    endpoint = api_config.get("endpoint")
    method = (api_config.get("method") or "").upper()
    if not endpoint or not method:
        return {
            "ok": False,
            "error": "missing_endpoint_or_method",
            "login_type": SiteLoginType.API.value,
        }

    cookies_to_store = list(api_config.get("cookies_to_store") or [])
    cookie_map: Dict[str, Any] = dict(api_config.get("cookies") or {})
    if not cookies_to_store and cookie_map:
        cookies_to_store = list(cookie_map.keys())

    required_cookie_names = list(sc.required_cookies or [])
    if not required_cookie_names:
        required_cookie_names = list(cookies_to_store)

    expected_cookie_names: List[str] = list(cookies_to_store)
    if not expected_cookie_names:
        expected_cookie_names = list(required_cookie_names)

    context: Dict[str, Any] = {
        "username": "dummy-user",
        "password": "dummy-password",
        "credential.username": "dummy-user",
        "credential.password": "dummy-password",
        "config_name": sc.name,
        "site_url": sc.site_url,
    }

    session = requests.Session()
    step_results: List[Dict[str, Any]] = []
    login_response: Optional[requests.Response] = None

    try:
        pre_login_steps = api_config.get("pre_login") or []
        if isinstance(pre_login_steps, dict):
            pre_login_steps = [pre_login_steps]

        for idx, step in enumerate(pre_login_steps):
            if not isinstance(step, dict):
                continue
            name = f"pre_login[{idx}]"
            response = _execute_api_step(
                session,
                {
                    "endpoint": step.get("endpoint"),
                    "method": step.get("method"),
                    "headers": step.get("headers"),
                    "body": step.get("body"),
                },
                context,
                sc.name,
                name,
            )
            step_result = {
                "name": name,
                "status_code": getattr(response, "status_code", None),
                "ok": bool(response) and getattr(response, "status_code", 0) < 400,
            }
            if response is None:
                step_result["error"] = "request_failed"
            elif response.status_code >= 400:
                step_result["error"] = "http_error"
            step_results.append(step_result)
            if not step_result["ok"]:
                login_response = response
                break

        execute_login = True
        if step_results and not step_results[-1]["ok"]:
            execute_login = False

        if execute_login:
            login_response = _execute_api_step(
                session,
                {
                    "endpoint": api_config.get("endpoint"),
                    "method": api_config.get("method"),
                    "headers": api_config.get("headers"),
                    "body": api_config.get("body"),
                },
                context,
                sc.name,
                "login",
            )
            login_result = {
                "name": "login",
                "status_code": getattr(login_response, "status_code", None),
                "ok": bool(login_response)
                and getattr(login_response, "status_code", 0) < 400,
            }
            if login_response is None:
                login_result["error"] = "request_failed"
            elif login_response.status_code >= 400:
                login_result["error"] = "http_error"
            step_results.append(login_result)

        jar_cookies = {cookie.name: cookie for cookie in session.cookies}
        serialized_cookies = [_serialize_cookie(cookie) for cookie in jar_cookies.values()]

        resolved_cookie_map: Dict[str, Dict[str, Any]] = {}
        body_json: Any = None
        if login_response is not None:
            try:
                body_json = login_response.json()
            except ValueError:
                body_json = None

        for cookie_name, source in cookie_map.items():
            value: Any = None
            if isinstance(source, str):
                if source.startswith("$."):
                    value = _extract_json_pointer(body_json, source[2:])
                else:
                    cookie_obj = jar_cookies.get(source)
                    if cookie_obj:
                        value = cookie_obj.value
            resolved_cookie_map[cookie_name] = {
                "source": source,
                "value": value,
            }

        found_cookie_names = sorted(jar_cookies.keys())
        missing_expected = [
            name for name in expected_cookie_names if name and name not in jar_cookies
        ]
        missing_required = [
            name for name in required_cookie_names if name and name not in jar_cookies
        ]

        context_payload = {
            "steps": step_results,
            "cookies": {
                "found": serialized_cookies,
                "found_names": found_cookie_names,
                "expected": expected_cookie_names,
                "required": required_cookie_names,
                "missing_expected": missing_expected,
                "missing_required": missing_required,
            },
            "resolved_cookie_map": resolved_cookie_map,
        }

        overall_ok = (
            all(step.get("ok") for step in step_results)
            and not missing_required
            and not missing_expected
        )

        result: Dict[str, Any] = {
            "ok": bool(overall_ok),
            "status": getattr(login_response, "status_code", None),
            "login_type": SiteLoginType.API.value,
            "context": context_payload,
        }

        if not overall_ok:
            errors: List[str] = []
            for step in step_results:
                if not step.get("ok"):
                    if step.get("error") == "request_failed":
                        errors.append(f"{step['name']} request failed")
                    elif step.get("error") == "http_error":
                        errors.append(
                            f"{step['name']} returned status {step.get('status_code')}"
                        )
            if missing_required:
                errors.append(
                    "missing required cookies: " + ", ".join(sorted(missing_required))
                )
            elif missing_expected:
                errors.append(
                    "missing expected cookies: " + ", ".join(sorted(missing_expected))
                )
            if errors:
                result["error"] = "; ".join(errors)

        return result
    finally:
        session.close()


@router.post(
    "",
    response_model=SiteConfigOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(csrf_protect)],
    summary="Create a site config",
)
def create_site_config_v1(
    body: SiteConfigSchema,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
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
        count_stmt=select(func.count())
        .select_from(SiteConfigModel)
        .where(SiteConfigModel.owner_user_id == model.owner_user_id),
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

    return _site_config_to_schema(model)


@router.get("", response_model=SiteConfigsPage, summary="List site configs")
def list_site_configs_v1(
    current_user=Depends(get_current_user),
    session=Depends(get_session),
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
):
    user_id = current_user["sub"]
    stmt = select(SiteConfigModel).where(SiteConfigModel.owner_user_id == user_id)
    rows = session.exec(stmt).all()
    if search:
        q = search.lower()
        rows = [
            r
            for r in rows
            if q in (r.name or "").lower() or q in (r.site_url or "").lower()
        ]
    total = len(rows)
    start = (page - 1) * size
    end = start + size
    page_rows = rows[start:end]
    items = [_site_config_to_schema(r) for r in page_rows]
    has_next = (page * size) < total
    total_pages = int((total + size - 1) // size) if size else 1
    return SiteConfigsPage(
        items=items,
        total=total,
        page=page,
        size=size,
        has_next=has_next,
        total_pages=total_pages,
    )


@router.get(
    "/{config_id}",
    response_model=SiteConfigOut,
    summary="Retrieve a site config",
)
def get_site_config_v1(
    config_id: str,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    model = session.get(SiteConfigModel, config_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    if model.owner_user_id != current_user["sub"]:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    return _site_config_to_schema(model)


@router.put(
    "/{config_id}",
    response_model=SiteConfigOut,
    dependencies=[Depends(csrf_protect)],
    summary="Update a site config",
)
def update_site_config_v1(
    config_id: str,
    body: SiteConfigSchema,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
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

    return _site_config_to_schema(model)


@router.delete(
    "/{config_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(csrf_protect)],
    summary="Delete a site config",
)
def delete_site_config_v1(
    config_id: str,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
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


@router.post(
    "/{config_id}/test",
    response_model=dict,
    summary="Test site config selectors against the login page",
)
def test_site_config(
    config_id: str, current_user=Depends(get_current_user), session=Depends(get_session)
):
    sc = session.get(SiteConfigModel, config_id)
    if not sc or sc.owner_user_id != current_user["sub"]:
        return {"ok": False, "error": "not_found"}
    login_type = SiteLoginType(sc.login_type)
    if login_type == SiteLoginType.API:
        return _test_api_site_config(sc)
    if login_type != SiteLoginType.SELENIUM:
        return {
            "ok": False,
            "status": "skipped",
            "reason": "login_type_not_selenium",
            "login_type": login_type.value,
        }
    selectors = sc.selenium_config or {}
    url = sc.site_url
    try:
        with httpx.Client(
            timeout=10.0, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"}
        ) as client:
            r = client.get(url)
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "html.parser")
            username_selector = selectors.get("username_selector")
            password_selector = selectors.get("password_selector")
            login_button_selector = selectors.get("login_button_selector")
            found_user = (
                bool(soup.select(username_selector)) if username_selector else False
            )
            found_pass = (
                bool(soup.select(password_selector)) if password_selector else False
            )
            found_btn = (
                bool(soup.select(login_button_selector))
                if login_button_selector
                else False
            )
            ok = found_user and found_pass and found_btn
            return {
                "ok": ok,
                "status": r.status_code,
                "login_type": login_type.value,
                "found": {
                    "username_selector": found_user,
                    "password_selector": found_pass,
                    "login_button_selector": found_btn,
                },
            }
    except httpx.RequestError as e:
        return {"ok": False, "error": str(e), "login_type": login_type.value}


