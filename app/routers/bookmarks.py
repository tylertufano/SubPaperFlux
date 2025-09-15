import difflib
import re
import shlex
from dataclasses import dataclass
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
# Inline constant to avoid importing subpaperflux (which initializes Selenium at import time)
INSTAPAPER_BOOKMARKS_DELETE_URL = "https://www.instapaper.com/api/1.1/bookmarks/delete"


router = APIRouter(prefix="/bookmarks", tags=["bookmarks"])


ALLOWED_REGEX_FLAGS = {"i"}


@dataclass
class RegexFilter:
    field: str  # "title", "url", or "both"
    pattern: str
    flags: str


@dataclass
class SearchFilters:
    terms: List[str]
    title_terms: List[str]
    url_terms: List[str]
    regex_filters: List[RegexFilter]
    sort_preference: Optional[str]
    raw_search: Optional[str]


def _parse_regex_value(value: str, explicit_flags: Optional[str] = None) -> tuple[str, str]:
    pattern = value
    inline_flags = ""
    if value.startswith("/") and value.count("/") >= 2:
        last = value.rfind("/")
        pattern = value[1:last]
        inline_flags = value[last + 1 :]
    flags = set(explicit_flags or "") | set(inline_flags)
    unknown = flags - ALLOWED_REGEX_FLAGS - {""}
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unsupported regex flags: {''.join(sorted(unknown))}")
    flag_str = "".join(sorted(ALLOWED_REGEX_FLAGS & flags))
    try:
        re.compile(pattern, re.IGNORECASE if "i" in flag_str else 0)
    except re.error as exc:
        raise HTTPException(status_code=400, detail=f"Invalid regex pattern: {exc}") from exc
    return pattern, flag_str


def _collect_filters(
    search: Optional[str],
    title_query: Optional[str],
    url_query: Optional[str],
    regex_value: Optional[str],
    regex_target: Optional[str],
    regex_flags: Optional[str],
) -> SearchFilters:
    terms: List[str] = []
    title_terms: List[str] = []
    url_terms: List[str] = []
    regex_filters: List[RegexFilter] = []
    sort_preference: Optional[str] = None

    def add_regex(field: str, raw: str, flags: Optional[str] = None):
        if not raw:
            return
        pattern, parsed_flags = _parse_regex_value(raw, flags)
        regex_filters.append(RegexFilter(field=field, pattern=pattern, flags=parsed_flags))

    if search:
        try:
            parts = shlex.split(search)
        except ValueError:
            parts = [search]
        for part in parts:
            lower = part.lower()
            if lower.startswith("title~"):
                add_regex("title", part[len("title~") :])
                continue
            if lower.startswith("url~"):
                add_regex("url", part[len("url~") :])
                continue
            if ":" in part:
                key, value = part.split(":", 1)
                key_l = key.lower()
                if key_l == "title":
                    title_terms.append(value)
                    continue
                if key_l == "url":
                    url_terms.append(value)
                    continue
                if key_l in {"regex", "re"}:
                    add_regex("both", value)
                    continue
                if key_l == "sort":
                    sort_preference = value.lower()
                    continue
            terms.append(part)

    if title_query:
        title_terms.append(title_query)
    if url_query:
        url_terms.append(url_query)
    if regex_value:
        target = (regex_target or "both").lower()
        if target not in {"title", "url", "both"}:
            raise HTTPException(status_code=400, detail="regex_target must be title, url, or both")
        add_regex(target, regex_value, regex_flags)

    return SearchFilters(
        terms=terms,
        title_terms=title_terms,
        url_terms=url_terms,
        regex_filters=regex_filters,
        sort_preference=sort_preference,
        raw_search=search,
    )


def _sql_clauses(filters: SearchFilters):
    clauses = []
    for term in filters.terms:
        like = f"%{term}%"
        clauses.append(or_(Bookmark.title.ilike(like), Bookmark.url.ilike(like)))
    for term in filters.title_terms:
        clauses.append(Bookmark.title.ilike(f"%{term}%"))
    for term in filters.url_terms:
        clauses.append(Bookmark.url.ilike(f"%{term}%"))
    for rf in filters.regex_filters:
        op = "~*" if "i" in rf.flags else "~"

        def clause_for(column):
            return func.coalesce(column, "").op(op)(rf.pattern)

        if rf.field == "title":
            clauses.append(clause_for(Bookmark.title))
        elif rf.field == "url":
            clauses.append(clause_for(Bookmark.url))
        else:
            clauses.append(or_(clause_for(Bookmark.title), clause_for(Bookmark.url)))
    return clauses


def _similarity_term(filters: SearchFilters) -> Optional[str]:
    joined = " ".join([*filters.terms, *filters.title_terms, *filters.url_terms]).strip()
    if joined:
        return joined
    return filters.raw_search or None


def _python_filter(rows: List["Bookmark"], filters: SearchFilters) -> List["Bookmark"]:
    if not (filters.terms or filters.title_terms or filters.url_terms or filters.regex_filters):
        return rows
    compiled = []
    for rf in filters.regex_filters:
        flags = re.IGNORECASE if "i" in rf.flags else 0
        compiled.append((rf, re.compile(rf.pattern, flags)))
    filtered: List[Bookmark] = []
    for row in rows:
        title = (row.title or "")
        url = (row.url or "")
        lt = title.lower()
        lu = url.lower()
        ok = True
        for term in filters.terms:
            lt_term = term.lower()
            if lt_term not in lt and lt_term not in lu:
                ok = False
                break
        if not ok:
            continue
        for term in filters.title_terms:
            if term.lower() not in lt:
                ok = False
                break
        if not ok:
            continue
        for term in filters.url_terms:
            if term.lower() not in lu:
                ok = False
                break
        if not ok:
            continue
        for rf, pattern in compiled:
            targets = []
            if rf.field in {"title", "both"}:
                targets.append(title)
            if rf.field in {"url", "both"}:
                targets.append(url)
            if not any(pattern.search(target or "") for target in targets):
                ok = False
                break
        if ok:
            filtered.append(row)
    return filtered


def _python_similarity_sort(rows: List["Bookmark"], query: Optional[str]) -> List["Bookmark"]:
    if not query:
        return rows
    q = query.lower()

    def score(row: Bookmark):
        title = (row.title or "").lower()
        url = (row.url or "").lower()
        title_score = difflib.SequenceMatcher(a=q, b=title).ratio()
        url_score = difflib.SequenceMatcher(a=q, b=url).ratio()
        return max(title_score, url_score)

    return sorted(rows, key=lambda r: (score(r), r.published_at or datetime.min), reverse=True)


def _apply_sorting(stmt, sort_choice: Optional[str], sort_dir: Optional[str]):
    if sort_choice == "relevance":
        return stmt
    if sort_choice:
        dir_desc = (sort_dir or "desc").lower() == "desc"
        col = {
            "title": Bookmark.title,
            "url": Bookmark.url,
            "published_at": Bookmark.published_at,
        }[sort_choice]
        if dir_desc:
            return stmt.order_by(col.desc(), Bookmark.id.desc())
        return stmt.order_by(col.asc(), Bookmark.id.asc())
    return stmt.order_by(Bookmark.published_at.desc(), Bookmark.id.desc())


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
    sort_by: Optional[str] = Query(None, pattern="^(title|url|published_at|relevance)$"),
    sort_dir: Optional[str] = Query(None, pattern="^(asc|desc)$"),
    title_query: Optional[str] = Query(None),
    url_query: Optional[str] = Query(None),
    regex: Optional[str] = Query(None),
    regex_target: Optional[str] = Query("both", pattern="^(title|url|both)$"),
    regex_flags: Optional[str] = Query(None, pattern="^[imxs]*$"),
):
    user_id = current_user["sub"]
    # parse since/until to ISO strings; with TIMESTAMPTZ in PG the comparison will work; on SQLite it treats as text
    base = select(Bookmark)
    base = _apply_filters(base, user_id, feed_id, since, until)
    # Total count (without pagination)
    count_stmt = select(func.count()).select_from(Bookmark)
    count_stmt = _apply_filters(count_stmt, user_id, feed_id, since, until)
    total = session.exec(count_stmt).one()

    filters = _collect_filters(search, title_query, url_query, regex, regex_target, regex_flags)
    chosen_sort = sort_by or filters.sort_preference
    similarity_query = _similarity_term(filters)
    use_similarity = bool(similarity_query) and (fuzzy or chosen_sort == "relevance")

    if is_postgres():
        clauses = _sql_clauses(filters)
        stmt = base
        count_stmt = select(func.count()).select_from(Bookmark)
        count_stmt = _apply_filters(count_stmt, user_id, feed_id, since, until)
        for clause in clauses:
            stmt = stmt.where(clause)
            count_stmt = count_stmt.where(clause)
        total = session.exec(count_stmt).one()
        if use_similarity:
            term_literal = func.lower(literal(similarity_query))
            sim_title = func.similarity(func.lower(func.coalesce(Bookmark.title, "")), term_literal)
            sim_url = func.similarity(func.lower(func.coalesce(Bookmark.url, "")), term_literal)
            stmt = stmt.order_by(func.greatest(sim_title, sim_url).desc(), Bookmark.published_at.desc(), Bookmark.id.desc())
        stmt = _apply_sorting(stmt, chosen_sort if chosen_sort != "relevance" else None, sort_dir)
        stmt = stmt.offset((page - 1) * size).limit(size)
        rows = session.exec(stmt).all()
    else:
        stmt_sorted = _apply_sorting(base, chosen_sort if chosen_sort != "relevance" else None, sort_dir)
        rows_all = session.exec(stmt_sorted).all()
        rows_filtered = _python_filter(rows_all, filters)
        if use_similarity:
            rows_filtered = _python_similarity_sort(rows_filtered, similarity_query)
        total = len(rows_filtered)
        start = (page - 1) * size
        end = start + size
        rows = rows_filtered[start:end]

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
    title_query: Optional[str] = Query(None),
    url_query: Optional[str] = Query(None),
    regex: Optional[str] = Query(None),
    regex_target: Optional[str] = Query("both", pattern="^(title|url|both)$"),
    regex_flags: Optional[str] = Query(None, pattern="^[imxs]*$"),
    size: int = Query(20, ge=1, le=200),
):
    user_id = current_user["sub"]
    filters = _collect_filters(search, title_query, url_query, regex, regex_target, regex_flags)
    base = select(Bookmark)
    base = _apply_filters(base, user_id, feed_id, since, until)
    if is_postgres():
        clauses = _sql_clauses(filters)
        count_stmt = select(func.count()).select_from(Bookmark)
        count_stmt = _apply_filters(count_stmt, user_id, feed_id, since, until)
        for clause in clauses:
            count_stmt = count_stmt.where(clause)
        total = session.exec(count_stmt).one()
    else:
        rows = session.exec(base).all()
        total = len(_python_filter(rows, filters))
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
    title_query: Optional[str] = Query(None),
    url_query: Optional[str] = Query(None),
    regex: Optional[str] = Query(None),
    regex_target: Optional[str] = Query("both", pattern="^(title|url|both)$"),
    regex_flags: Optional[str] = Query(None, pattern="^[imxs]*$"),
):
    user_id = current_user["sub"]
    filters = _collect_filters(search, title_query, url_query, regex, regex_target, regex_flags)
    base = select(Bookmark)
    base = _apply_filters(base, user_id, feed_id, since, until)
    if is_postgres():
        clauses = _sql_clauses(filters)
        count_stmt = select(func.count()).select_from(Bookmark)
        count_stmt = _apply_filters(count_stmt, user_id, feed_id, since, until)
        for clause in clauses:
            count_stmt = count_stmt.where(clause)
        total = session.exec(count_stmt).one()
    else:
        rows = session.exec(base).all()
        total = len(_python_filter(rows, filters))
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
    sort_by: Optional[str] = Query(None, pattern="^(title|url|published_at|relevance)$"),
    sort_dir: Optional[str] = Query(None, pattern="^(asc|desc)$"),
    title_query: Optional[str] = Query(None),
    url_query: Optional[str] = Query(None),
    regex: Optional[str] = Query(None),
    regex_target: Optional[str] = Query("both", pattern="^(title|url|both)$"),
    regex_flags: Optional[str] = Query(None, pattern="^[imxs]*$"),
):
    user_id = current_user["sub"]
    base = select(Bookmark)
    base = _apply_filters(base, user_id, feed_id, since, until)
    filters = _collect_filters(search, title_query, url_query, regex, regex_target, regex_flags)
    chosen_sort = sort_by or filters.sort_preference
    similarity_query = _similarity_term(filters)
    use_similarity = bool(similarity_query) and (fuzzy or chosen_sort == "relevance")

    if is_postgres():
        stmt = base
        for clause in _sql_clauses(filters):
            stmt = stmt.where(clause)
        if use_similarity:
            term_literal = func.lower(literal(similarity_query))
            sim_title = func.similarity(func.lower(func.coalesce(Bookmark.title, "")), term_literal)
            sim_url = func.similarity(func.lower(func.coalesce(Bookmark.url, "")), term_literal)
            stmt = stmt.order_by(func.greatest(sim_title, sim_url).desc(), Bookmark.published_at.desc(), Bookmark.id.desc())
        stmt = _apply_sorting(stmt, chosen_sort if chosen_sort != "relevance" else None, sort_dir)
        rows = session.exec(stmt).all()
    else:
        stmt_sorted = _apply_sorting(base, chosen_sort if chosen_sort != "relevance" else None, sort_dir)
        rows = session.exec(stmt_sorted).all()
        rows = _python_filter(rows, filters)
        if use_similarity:
            rows = _python_similarity_sort(rows, similarity_query)

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
