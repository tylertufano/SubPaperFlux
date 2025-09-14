from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import select

from ..auth.oidc import get_current_user
from ..db import get_session
from ..models import Feed
from ..schemas import FeedsPage, FeedOut


router = APIRouter(prefix="/v1/feeds", tags=["v1"])


@router.get("", response_model=FeedsPage, summary="List feeds")
@router.get("/", response_model=FeedsPage, summary="List feeds")
def list_feeds_v1(
    current_user=Depends(get_current_user),
    session=Depends(get_session),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
):
    user_id = current_user["sub"]
    stmt = select(Feed).where(Feed.owner_user_id == user_id)
    total = len(session.exec(stmt).all())
    rows = session.exec(stmt.offset((page - 1) * size).limit(size)).all()
    items = [
        FeedOut(
            id=r.id,
            url=r.url,
            poll_frequency=r.poll_frequency,
            initial_lookback_period=r.initial_lookback_period,
            is_paywalled=r.is_paywalled,
            rss_requires_auth=r.rss_requires_auth,
            site_config_id=r.site_config_id,
            owner_user_id=r.owner_user_id,
        )
        for r in rows
    ]
    has_next = (page * size) < total
    total_pages = int((total + size - 1) // size) if size else 1
    return FeedsPage(items=items, total=total, page=page, size=size, has_next=has_next, total_pages=total_pages)
