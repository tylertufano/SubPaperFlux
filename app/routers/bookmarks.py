from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import select, func
from sqlalchemy import or_, literal

from ..auth.oidc import get_current_user
from ..db import get_session
from ..models import Bookmark
from ..jobs.util_subpaperflux import get_instapaper_oauth_session
from ..schemas import BookmarksPage, BookmarkOut
from ..db import is_postgres
from ..security.csrf import csrf_protect
from subpaperflux import INSTAPAPER_BOOKMARKS_DELETE_URL


router = APIRouter(prefix="/bookmarks", tags=["bookmarks"])


def _apply_filters(stmt, user_id: str, feed_id: Optional[str], since: Optional[str], until: Optional[str]):
    stmt = stmt.where(Bookmark.owner_user_id == user_id)
    if feed_id:
        stmt = stmt.where(Bookmark.feed_id == feed_id)
    if since:
        stmt = stmt.where(Bookmark.published_at >= since)
    if until:
        stmt = stmt.where(Bookmark.published_at <= until)
    return stmt


@router.get("", response_model=BookmarksPage)
@router.get("/", response_model=BookmarksPage)
def list_bookmarks(
    current_user=Depends(get_current_user),
    session=Depends(get_session),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    search: Optional[str] = None,
    fuzzy: bool = Query(False),
    feed_id: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
):
    user_id = current_user["sub"]
    # parse since/until to ISO strings; with TIMESTAMPTZ in PG the comparison will work; on SQLite it treats as text
    base = select(Bookmark)
    base = _apply_filters(base, user_id, feed_id, since, until)
    # Total count (without pagination)
    count_stmt = select(func.count()).select_from(Bookmark)
    count_stmt = _apply_filters(count_stmt, user_id, feed_id, since, until)
    total = session.exec(count_stmt).one()

    # Order, paginate
    stmt = base.order_by(Bookmark.published_at.desc(), Bookmark.id.desc()).offset((page - 1) * size).limit(size)
    rows = session.exec(stmt).all()
    # Optional search: push to SQL for Postgres (ILIKE), otherwise Python filter
    if search:
        if is_postgres():
            # Re-run query with SQL filter for accuracy and performance
            ilike = f"%{search}%"
            filt = or_(Bookmark.title.ilike(ilike), Bookmark.url.ilike(ilike))
            stmt_search = base.where(filt)
            if fuzzy:
                # Order by similarity if fuzzy requested
                sim_title = func.similarity(func.lower(Bookmark.title), func.lower(literal(search)))
                sim_url = func.similarity(func.lower(Bookmark.url), func.lower(literal(search)))
                stmt_search = stmt_search.order_by(func.greatest(sim_title, sim_url).desc())
            else:
                stmt_search = stmt_search.order_by(Bookmark.published_at.desc(), Bookmark.id.desc())
            count_stmt = select(func.count()).select_from(Bookmark)
            count_stmt = _apply_filters(count_stmt, user_id, feed_id, since, until).where(filt)
            total = session.exec(count_stmt).one()
            stmt_search = stmt_search.offset((page - 1) * size).limit(size)
            rows = session.exec(stmt_search).all()
        else:
            q = search.lower()
            rows = [r for r in rows if (r.title and q in r.title.lower()) or (r.url and q in r.url.lower())]

    items = []
    for r in rows:
        dt = r.published_at.isoformat() if getattr(r, "published_at", None) else None
        items.append(
            BookmarkOut(
                id=r.id,
                instapaper_bookmark_id=r.instapaper_bookmark_id,
                title=r.title,
                url=r.url,
                content_location=r.content_location,
                feed_id=r.feed_id,
                published_at=dt,
            )
        )
    has_next = (page * size) < total
    total_pages = int((total + size - 1) // size) if size else 1
    return BookmarksPage(items=items, total=int(total), page=page, size=size, has_next=has_next, total_pages=total_pages)


@router.delete("/{bookmark_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(csrf_protect)])
def delete_bookmark(bookmark_id: str, current_user=Depends(get_current_user), session=Depends(get_session), delete_remote: bool = Query(True)):
    bm = session.get(Bookmark, bookmark_id)
    if not bm or bm.owner_user_id != current_user["sub"]:
        raise HTTPException(status_code=404, detail="Not found")
    if delete_remote:
        oauth = get_instapaper_oauth_session(current_user["sub"])
        if oauth:
            try:
                resp = oauth.post(INSTAPAPER_BOOKMARKS_DELETE_URL, data={"bookmark_id": bm.instapaper_bookmark_id})
                resp.raise_for_status()
            except Exception:
                # Swallow remote errors if DB delete is desired anyway
                pass
    session.delete(bm)
    session.commit()
    return None


@router.get("/{bookmark_id}", response_model=BookmarkOut)
def get_bookmark(bookmark_id: str, current_user=Depends(get_current_user), session=Depends(get_session)):
    bm = session.get(Bookmark, bookmark_id)
    if not bm or bm.owner_user_id != current_user["sub"]:
        raise HTTPException(status_code=404, detail="Not found")
    return BookmarkOut(
        id=bm.id,
        instapaper_bookmark_id=bm.instapaper_bookmark_id,
        title=bm.title,
        url=bm.url,
        content_location=bm.content_location,
        feed_id=bm.feed_id,
        published_at=(bm.published_at.isoformat() if bm.published_at else None),
    )


@router.get("/count", response_model=dict)
def count_bookmarks(
    current_user=Depends(get_current_user),
    session=Depends(get_session),
    feed_id: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    search: Optional[str] = None,
    size: int = Query(20, ge=1, le=200),
):
    user_id = current_user["sub"]
    if search and is_postgres():
        ilike = f"%{search}%"
        filt = or_(Bookmark.title.ilike(ilike), Bookmark.url.ilike(ilike))
        count_stmt = select(func.count()).select_from(Bookmark)
        count_stmt = _apply_filters(count_stmt, user_id, feed_id, since, until).where(filt)
        total = session.exec(count_stmt).one()
        total_pages = int((total + size - 1) // size) if size else 1
        return {"total": int(total), "total_pages": total_pages}
    else:
        count_stmt = select(func.count()).select_from(Bookmark)
        count_stmt = _apply_filters(count_stmt, user_id, feed_id, since, until)
        total = session.exec(count_stmt).one()
        if search:
            base = select(Bookmark)
            base = _apply_filters(base, user_id, feed_id, since, until)
            rows = session.exec(base).all()
            q = search.lower()
            total = len([r for r in rows if (r.title and q in r.title.lower()) or (r.url and q in r.url.lower())])
        total_pages = int((total + size - 1) // size) if size else 1
        return {"total": int(total), "total_pages": total_pages}


@router.head("")
@router.head("/")
def head_bookmarks(
    current_user=Depends(get_current_user),
    session=Depends(get_session),
    search: Optional[str] = None,
    feed_id: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
):
    user_id = current_user["sub"]
    total = 0
    if search and is_postgres():
        ilike = f"%{search}%"
        filt = or_(Bookmark.title.ilike(ilike), Bookmark.url.ilike(ilike))
        count_stmt = select(func.count()).select_from(Bookmark)
        count_stmt = _apply_filters(count_stmt, user_id, feed_id, since, until).where(filt)
        total = session.exec(count_stmt).one()
    else:
        count_stmt = select(func.count()).select_from(Bookmark)
        count_stmt = _apply_filters(count_stmt, user_id, feed_id, since, until)
        total = session.exec(count_stmt).one()
        if search:
            base = select(Bookmark)
            base = _apply_filters(base, user_id, feed_id, since, until)
            rows = session.exec(base).all()
            q = search.lower()
            total = len([r for r in rows if (r.title and q in r.title.lower()) or (r.url and q in r.url.lower())])
    # Return headers only
    from fastapi import Response
    return Response(headers={"X-Total-Count": str(int(total))})


@router.get("/export")
def export_bookmarks(
    current_user=Depends(get_current_user),
    session=Depends(get_session),
    format: str = Query("json", pattern="^(json|csv)$"),
    search: Optional[str] = None,
    fuzzy: bool = Query(False),
    feed_id: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
):
    user_id = current_user["sub"]
    base = select(Bookmark)
    base = _apply_filters(base, user_id, feed_id, since, until)
    rows = session.exec(base.order_by(Bookmark.published_at.desc(), Bookmark.id.desc())).all()
    if search:
        if is_postgres():
            ilike = f"%{search}%"
            rows = session.exec(base.where(or_(Bookmark.title.ilike(ilike), Bookmark.url.ilike(ilike)))).all()
        else:
            q = search.lower()
            rows = [r for r in rows if (r.title and q in r.title.lower()) or (r.url and q in r.url.lower())]
    if format == "json":
        return [
            {
                "id": r.id,
                "instapaper_bookmark_id": r.instapaper_bookmark_id,
                "title": r.title,
                "url": r.url,
                "content_location": r.content_location,
                "feed_id": r.feed_id,
                "published_at": (r.published_at.isoformat() if r.published_at else None),
            }
            for r in rows
        ]
    else:
        import csv
        import io
        from fastapi.responses import PlainTextResponse

        headers = ["id", "instapaper_bookmark_id", "title", "url", "content_location", "feed_id", "published_at"]
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=headers)
        writer.writeheader()
        for r in rows:
            writer.writerow({
                "id": r.id,
                "instapaper_bookmark_id": r.instapaper_bookmark_id,
                "title": r.title or "",
                "url": r.url or "",
                "content_location": r.content_location or "",
                "feed_id": r.feed_id or "",
                "published_at": (r.published_at.isoformat() if r.published_at else ""),
            })
        return PlainTextResponse(buf.getvalue(), media_type="text/csv")


@router.post("/bulk-delete", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(csrf_protect)])
def bulk_delete_bookmarks(
    body: dict,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    ids = body.get("ids") or []
    delete_remote = bool(body.get("delete_remote", True))
    if not isinstance(ids, list) or not ids:
        raise HTTPException(status_code=400, detail="ids list required")
    oauth = get_instapaper_oauth_session(current_user["sub"]) if delete_remote else None
    for bid in ids:
        bm = session.get(Bookmark, str(bid))
        if not bm or bm.owner_user_id != current_user["sub"]:
            continue
        if oauth:
            try:
                resp = oauth.post(INSTAPAPER_BOOKMARKS_DELETE_URL, data={"bookmark_id": bm.instapaper_bookmark_id})
                resp.raise_for_status()
            except Exception:
                pass
        session.delete(bm)
    session.commit()
    return None
