import copy
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlmodel import select

from ..audit import record_audit_log
from ..auth.oidc import get_current_user
from ..auth import (
    PERMISSION_MANAGE_GLOBAL_SITE_CONFIGS,
    PERMISSION_READ_GLOBAL_SITE_CONFIGS,
    has_permission,
)
from ..config import is_user_mgmt_enforce_enabled
from ..db import get_session
from ..models import SiteConfig, SiteLoginType
from ..schemas import (
    SiteConfigApiOut,
    SiteConfigOut,
    SiteConfigSeleniumOut,
    SiteConfigsPage,
)
from ..util.quotas import enforce_user_quota


router = APIRouter(prefix="/v1/site-configs", tags=["v1"])


def _ensure_permission(
    session, current_user, permission: str, *, owner_id: Optional[str] = None
) -> bool:
    allowed = has_permission(session, current_user, permission, owner_id=owner_id)
    if is_user_mgmt_enforce_enabled() and not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return allowed


def _site_config_to_schema(model: SiteConfig) -> SiteConfigOut:
    if model.login_type == SiteLoginType.SELENIUM:
        return SiteConfigSeleniumOut(
            id=model.id,
            name=model.name,
            site_url=model.site_url,
            owner_user_id=model.owner_user_id,
            selenium_config=model.selenium_config,
        )
    return SiteConfigApiOut(
        id=model.id,
        name=model.name,
        site_url=model.site_url,
        owner_user_id=model.owner_user_id,
        api_config=model.api_config,
    )


@router.get("/", response_model=SiteConfigsPage, summary="List site configs")
def list_site_configs_v1(
    current_user=Depends(get_current_user),
    session=Depends(get_session),
    include_global: bool = Query(True),
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
):
    user_id = current_user["sub"]
    stmt = select(SiteConfig).where(SiteConfig.owner_user_id == user_id)
    if include_global:
        _ensure_permission(
            session,
            current_user,
            PERMISSION_READ_GLOBAL_SITE_CONFIGS,
        )
        # naive union via two queries
        mine = session.exec(stmt).all()
        global_stmt = select(SiteConfig).where(SiteConfig.owner_user_id.is_(None))
        globs = session.exec(global_stmt).all()
        rows = mine + globs
    else:
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


@router.post(
    "/{config_id}/test",
    response_model=dict,
    summary="Test site config selectors against the login page",
)
def test_site_config(
    config_id: str, current_user=Depends(get_current_user), session=Depends(get_session)
):
    sc = session.get(SiteConfig, config_id)
    if not sc or sc.owner_user_id not in (current_user["sub"], None):
        return {"ok": False, "error": "not_found"}
    if sc.owner_user_id is None:
        _ensure_permission(
            session,
            current_user,
            PERMISSION_MANAGE_GLOBAL_SITE_CONFIGS,
        )
    if sc.login_type != SiteLoginType.SELENIUM:
        return {"ok": False, "error": "unsupported_login_type"}
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
                "found": {
                    "username_selector": found_user,
                    "password_selector": found_pass,
                    "login_button_selector": found_btn,
                },
            }
    except httpx.RequestError as e:
        return {"ok": False, "error": str(e)}


@router.post(
    "/{config_id}/copy",
    response_model=SiteConfigOut,
    status_code=status.HTTP_201_CREATED,
)
def copy_site_config_v1(
    config_id: str,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    source = session.get(SiteConfig, config_id)
    if not source or source.owner_user_id is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    try:
        allowed = _ensure_permission(
            session,
            current_user,
            PERMISSION_READ_GLOBAL_SITE_CONFIGS,
        )
    except HTTPException as exc:  # pragma: no cover - defensive branch
        if exc.status_code == status.HTTP_403_FORBIDDEN:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Not found"
            ) from exc
        raise

    if not allowed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    user_id = current_user["sub"]

    enforce_user_quota(
        session,
        user_id,
        quota_field="quota_site_configs",
        resource_name="Site config",
        count_stmt=select(func.count())
        .select_from(SiteConfig)
        .where(SiteConfig.owner_user_id == user_id),
    )

    clone = SiteConfig(
        name=source.name,
        site_url=source.site_url,
        login_type=source.login_type,
        selenium_config=copy.deepcopy(source.selenium_config),
        api_config=copy.deepcopy(source.api_config),
        owner_user_id=user_id,
    )

    session.add(clone)

    record_audit_log(
        session,
        entity_type="setting",
        entity_id=clone.id,
        action="copy",
        owner_user_id=clone.owner_user_id,
        actor_user_id=user_id,
        details={
            "source_config_id": source.id,
            "name": clone.name,
            "site_url": clone.site_url,
        },
    )

    session.commit()
    session.refresh(clone)

    return _site_config_to_schema(clone)
