from typing import Optional

from fastapi import APIRouter, Depends, Query
from bs4 import BeautifulSoup
import httpx
from sqlmodel import select

from ..auth.oidc import get_current_user
from ..db import get_session
from ..models import SiteConfig
from ..schemas import SiteConfigOut, SiteConfigsPage


router = APIRouter(prefix="/v1/site-configs", tags=["v1"])


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
        # naive union via two queries
        mine = session.exec(stmt).all()
        global_stmt = select(SiteConfig).where(SiteConfig.owner_user_id.is_(None))
        globs = session.exec(global_stmt).all()
        rows = mine + globs
    else:
        rows = session.exec(stmt).all()
    if search:
        q = search.lower()
        rows = [r for r in rows if q in (r.name or "").lower() or q in (r.site_url or "").lower()]
    total = len(rows)
    start = (page - 1) * size
    end = start + size
    page_rows = rows[start:end]
    items = [
        SiteConfigOut(
            id=r.id,
            name=r.name,
            site_url=r.site_url,
            username_selector=r.username_selector,
            password_selector=r.password_selector,
            login_button_selector=r.login_button_selector,
            post_login_selector=r.post_login_selector,
            cookies_to_store=r.cookies_to_store or [],
            owner_user_id=r.owner_user_id,
        )
        for r in page_rows
    ]
    has_next = (page * size) < total
    total_pages = int((total + size - 1) // size) if size else 1
    return SiteConfigsPage(items=items, total=total, page=page, size=size, has_next=has_next, total_pages=total_pages)


@router.post("/{config_id}/test", response_model=dict, summary="Test site config selectors against the login page")
def test_site_config(config_id: str, current_user=Depends(get_current_user), session=Depends(get_session)):
    sc = session.get(SiteConfig, config_id)
    if not sc or sc.owner_user_id not in (current_user["sub"], None):
        return {"ok": False, "error": "not_found"}
    url = sc.site_url
    try:
        with httpx.Client(timeout=10.0, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"}) as client:
            r = client.get(url)
            r.raise_for_status()
            soup = BeautifulSoup(r.text, 'html.parser')
            found_user = bool(soup.select(sc.username_selector)) if sc.username_selector else False
            found_pass = bool(soup.select(sc.password_selector)) if sc.password_selector else False
            found_btn = bool(soup.select(sc.login_button_selector)) if sc.login_button_selector else False
            ok = found_user and found_pass and found_btn
            return {
                "ok": ok,
                "status": r.status_code,
                "found": {
                    "username_selector": found_user,
                    "password_selector": found_pass,
                    "login_button_selector": found_btn,
                }
            }
    except httpx.RequestError as e:
        return {"ok": False, "error": str(e)}
