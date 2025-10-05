import asyncio
import difflib
import json
import logging
import os
import re
import shlex
from dataclasses import dataclass
from datetime import datetime
from typing import Any, AsyncGenerator, Dict, Iterable, List, Optional
from urllib.parse import urlparse
from uuid import uuid4

import httpx
from bleach.sanitizer import Cleaner
from bs4 import BeautifulSoup, Doctype
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, StreamingResponse
from sqlalchemy import or_, literal
from sqlalchemy.exc import IntegrityError
from sqlmodel import delete, func, select
from ..audit import record_audit_log
from ..auth import (
    PERMISSION_MANAGE_BOOKMARKS,
    PERMISSION_READ_BOOKMARKS,
    has_permission,
)
from ..auth.oidc import get_current_user
from ..config import is_user_mgmt_enforce_enabled
from ..db import get_session
from ..db import is_postgres
from ..models import (
    Bookmark,
    Credential,
    Feed,
    FeedTagLink,
    Folder,
    Job,
    JobSchedule,
    Tag,
)
from ..jobs.util_subpaperflux import (
    get_instapaper_oauth_session,
    get_ordered_feed_tag_ids,
    publish_url,
    resolve_effective_folder,
    sync_instapaper_folders,
    translate_tag_ids_to_names,
)
from ..schemas import (
    BookmarkOut,
    BookmarksPage,
    FolderCreate,
    FolderOut,
    FolderUpdate,
    TagCreate,
    TagOut,
    TagUpdate,
)
from ..security.csrf import csrf_protect
# Inline constant to avoid importing subpaperflux (which initializes Selenium at import time)
INSTAPAPER_BOOKMARKS_DELETE_URL = "https://www.instapaper.com/api/1.1/bookmarks/delete"
INSTAPAPER_BOOKMARKS_MOVE_URL = "https://www.instapaper.com/api/1.1/bookmarks/move"


router = APIRouter(prefix="/bookmarks", tags=["bookmarks"])


ALLOWED_REGEX_FLAGS = {"i"}

_FETCHABLE_SCHEMES = {"http", "https"}

_ALLOWED_PREVIEW_TAGS = {
    "a",
    "abbr",
    "b",
    "blockquote",
    "br",
    "code",
    "div",
    "em",
    "figcaption",
    "figure",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "img",
    "li",
    "ol",
    "p",
    "pre",
    "section",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
}

_ALLOWED_PREVIEW_ATTRS = {
    "a": ["href", "title"],
    "abbr": ["title"],
    "img": ["alt", "title", "src"],
    "td": ["colspan", "rowspan"],
    "th": ["colspan", "rowspan", "scope"],
}

_ALLOWED_PREVIEW_PROTOCOLS = ["http", "https", "mailto", "tel"]

_PREVIEW_CLEANER = Cleaner(
    tags=sorted(_ALLOWED_PREVIEW_TAGS),
    attributes=_ALLOWED_PREVIEW_ATTRS,
    protocols=_ALLOWED_PREVIEW_PROTOCOLS,
    strip=True,
    strip_comments=True,
)


def _get_request_user_id(current_user) -> Optional[str]:
    if current_user is None:
        return None
    if isinstance(current_user, dict):
        for key in ("sub", "id", "user_id"):
            value = current_user.get(key)
            if value:
                return str(value)
        return None
    if isinstance(current_user, str):
        return current_user or None
    for attr in ("sub", "id", "user_id"):
        value = getattr(current_user, attr, None)
        if value:
            return str(value)
    return None


def _record_rbac_denial(
    session,
    *,
    entity_type: str,
    entity_id: str,
    owner_user_id: Optional[str],
    actor_user_id: Optional[str],
    attempted_action: str,
    permission: str,
    detail: Optional[str],
) -> None:
    payload = {
        "reason": "rbac_denied",
        "attempted_action": attempted_action,
        "required_permission": permission,
    }
    if detail:
        payload["message"] = detail
    try:  # pragma: no cover - defensive reset before logging
        session.rollback()
    except Exception:
        logging.debug("Failed to rollback before RBAC audit log", exc_info=True)
    try:
        record_audit_log(
            session,
            entity_type=entity_type,
            entity_id=str(entity_id),
            action="deny",
            owner_user_id=owner_user_id,
            actor_user_id=actor_user_id,
            details=payload,
        )
        session.commit()
    except Exception:  # pragma: no cover - defensive logging on failure
        session.rollback()
        logging.exception(
            "Failed to record RBAC denial audit log for %s %s",
            entity_type,
            entity_id,
        )


def _require_owner_or_permission(
    session,
    current_user,
    *,
    owner_user_id: Optional[str],
    entity_type: str,
    entity_id: str,
    attempted_action: str,
    permission: str,
    mask_as_not_found: bool = True,
    not_found_detail: str = "Not found",
    forbidden_detail: Optional[str] = None,
) -> None:
    user_id = _get_request_user_id(current_user)
    if owner_user_id is None or owner_user_id == user_id:
        return
    enforcement_enabled = is_user_mgmt_enforce_enabled()
    if not enforcement_enabled:
        if mask_as_not_found:
            raise HTTPException(status_code=404, detail=not_found_detail)
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=forbidden_detail or "Forbidden",
        )

    allowed = has_permission(
        session,
        current_user,
        permission,
        owner_id=owner_user_id,
    )
    if allowed:
        return

    _record_rbac_denial(
        session,
        entity_type=entity_type,
        entity_id=str(entity_id),
        owner_user_id=owner_user_id,
        actor_user_id=user_id,
        attempted_action=attempted_action,
        permission=permission,
        detail=forbidden_detail,
    )
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        detail=forbidden_detail or "Forbidden",
    )


def _normalize_preview_url(url: str) -> Optional[str]:
    if not url:
        return None
    try:
        parsed = urlparse(url)
    except Exception:  # pragma: no cover - defensive
        return None
    if parsed.scheme:
        return url if parsed.scheme.lower() in _FETCHABLE_SCHEMES else None
    if parsed.netloc:
        return parsed._replace(scheme="https").geturl()
    return None


def _resolve_preview_source(bookmark: "Bookmark") -> Optional[str]:
    for candidate in (bookmark.content_location, bookmark.url):
        normalized = _normalize_preview_url(candidate) if candidate else None
        if normalized:
            return normalized
    return None


def _fetch_html(url: str) -> str:
    headers = {"User-Agent": "Mozilla/5.0 (compatible; SubPaperFlux/1.0)"}
    with httpx.Client(timeout=10.0, follow_redirects=True, headers=headers) as client:
        response = client.get(url)
        response.raise_for_status()
        return response.text


def _sanitize_html_content(html: str) -> str:
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    for element in list(soup.contents):
        if isinstance(element, Doctype):
            element.extract()
    body = soup.body
    if body:
        content = body.decode_contents()
        fragment = content if content else ""
    else:
        fragment = soup.decode()
    cleaned = _PREVIEW_CLEANER.clean(fragment)
    return cleaned.strip()


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


def _apply_filters(
    stmt,
    user_id: str,
    feed_id: Optional[str],
    since: Optional[str],
    until: Optional[str],
):
    stmt = stmt.where(Bookmark.owner_user_id == user_id)
    if feed_id:
        stmt = stmt.where(Bookmark.feed_id == feed_id)
    if since:
        stmt = stmt.where(Bookmark.published_at >= since)
    if until:
        stmt = stmt.where(Bookmark.published_at <= until)
    return stmt


def _get_bookmark_or_404(
    session,
    bookmark_id: str,
    current_user,
    *,
    permission: str = PERMISSION_MANAGE_BOOKMARKS,
    attempted_action: str = "access",
) -> Bookmark:
    bookmark = session.get(Bookmark, bookmark_id)
    if not bookmark:
        raise HTTPException(status_code=404, detail="Not found")
    _require_owner_or_permission(
        session,
        current_user,
        owner_user_id=bookmark.owner_user_id,
        entity_type="bookmark",
        entity_id=bookmark.id,
        attempted_action=attempted_action,
        permission=permission,
    )
    return bookmark


def _tag_to_out(tag: Tag) -> TagOut:
    return TagOut(id=tag.id, name=tag.name, bookmark_count=0)


def _folder_to_out(folder: Folder) -> FolderOut:
    return FolderOut(
        id=folder.id,
        name=folder.name,
        instapaper_folder_id=folder.instapaper_folder_id,
        bookmark_count=0,
    )


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
        raw_dt = getattr(r, "published_at", None)
        if isinstance(raw_dt, datetime):
            dt = raw_dt.isoformat()
        elif isinstance(raw_dt, str):
            dt = raw_dt
        else:
            dt = None
        items.append(
            BookmarkOut(
                id=r.id,
                instapaper_bookmark_id=r.instapaper_bookmark_id,
                title=r.title,
                url=r.url,
                content_location=r.content_location,
                feed_id=r.feed_id,
                published_at=dt,
                rss_entry=r.rss_entry or {},
                raw_html_content=r.raw_html_content,
                publication_statuses=r.publication_statuses or {},
                publication_flags=r.publication_flags or {},
            )
        )
    has_next = (page * size) < total
    total_pages = int((total + size - 1) // size) if size else 1
    return BookmarksPage(items=items, total=int(total), page=page, size=size, has_next=has_next, total_pages=total_pages)


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


@router.delete("/{bookmark_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(csrf_protect)])
def delete_bookmark(bookmark_id: str, current_user=Depends(get_current_user), session=Depends(get_session), delete_remote: bool = Query(True)):
    bm = session.get(Bookmark, bookmark_id)
    if not bm:
        raise HTTPException(status_code=404, detail="Not found")
    _require_owner_or_permission(
        session,
        current_user,
        owner_user_id=bm.owner_user_id,
        entity_type="bookmark",
        entity_id=bm.id,
        attempted_action="delete",
        permission=PERMISSION_MANAGE_BOOKMARKS,
    )
    if delete_remote and bm.instapaper_bookmark_id:
        oauth = get_instapaper_oauth_session(bm.owner_user_id)
        if oauth:
            try:
                resp = oauth.post(INSTAPAPER_BOOKMARKS_DELETE_URL, data={"bookmark_id": bm.instapaper_bookmark_id})
                resp.raise_for_status()
            except Exception:
                # Swallow remote errors if DB delete is desired anyway
                pass
    record_audit_log(
        session,
        entity_type="bookmark",
        entity_id=bm.id,
        action="delete",
        owner_user_id=bm.owner_user_id,
        actor_user_id=_get_request_user_id(current_user),
        details={
            "instapaper_bookmark_id": bm.instapaper_bookmark_id,
            "delete_remote": bool(delete_remote),
        },
    )
    session.delete(bm)
    session.commit()
    return None


@router.get("/tags", response_model=List[TagOut])
def list_tags(current_user=Depends(get_current_user), session=Depends(get_session)):
    user_id = current_user["sub"]
    stmt = select(Tag).where(Tag.owner_user_id == user_id).order_by(Tag.name)
    tags = session.exec(stmt).all()
    return [_tag_to_out(tag) for tag in tags]


@router.post(
    "/tags",
    response_model=TagOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(csrf_protect)],
)
def create_tag(tag: TagCreate, current_user=Depends(get_current_user), session=Depends(get_session)):
    user_id = current_user["sub"]
    name = (tag.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Tag name is required")
    record = Tag(owner_user_id=user_id, name=name)
    session.add(record)
    try:
        session.commit()
    except IntegrityError as exc:  # pragma: no cover - defensive
        session.rollback()
        logging.warning("Duplicate tag create ignored user=%s name=%s", user_id, name)
        raise HTTPException(status_code=400, detail="Tag already exists") from exc
    session.refresh(record)
    return _tag_to_out(record)


@router.put(
    "/tags/{tag_id}",
    response_model=TagOut,
    dependencies=[Depends(csrf_protect)],
)
def update_tag(
    tag_id: str,
    payload: TagUpdate,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    tag = session.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Not found")
    _require_owner_or_permission(
        session,
        current_user,
        owner_user_id=tag.owner_user_id,
        entity_type="tag",
        entity_id=tag.id,
        attempted_action="update",
        permission=PERMISSION_MANAGE_BOOKMARKS,
    )
    owner_id = tag.owner_user_id
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Tag name is required")
    if name != tag.name:
        exists = session.exec(
            select(Tag).where(
                (Tag.owner_user_id == owner_id) & (Tag.name == name) & (Tag.id != tag_id)
            )
        ).first()
        if exists:
            raise HTTPException(status_code=400, detail="Tag already exists")
        tag.name = name
    session.add(tag)
    session.commit()
    session.refresh(tag)
    return _tag_to_out(tag)


@router.delete(
    "/tags/{tag_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(csrf_protect)],
)
def delete_tag(tag_id: str, current_user=Depends(get_current_user), session=Depends(get_session)):
    tag = session.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Not found")
    _require_owner_or_permission(
        session,
        current_user,
        owner_user_id=tag.owner_user_id,
        entity_type="tag",
        entity_id=tag.id,
        attempted_action="delete",
        permission=PERMISSION_MANAGE_BOOKMARKS,
    )
    owner_id = tag.owner_user_id

    session.exec(delete(FeedTagLink).where(FeedTagLink.tag_id == tag.id))

    schedule_stmt = select(JobSchedule).where(JobSchedule.job_type == "publish")
    if owner_id is None:
        schedule_stmt = schedule_stmt.where(JobSchedule.owner_user_id.is_(None))
    else:
        schedule_stmt = schedule_stmt.where(JobSchedule.owner_user_id == owner_id)
    schedules = session.exec(schedule_stmt).all()
    for schedule in schedules:
        payload = dict(schedule.payload or {})
        original_tags = list(payload.get("tags") or [])
        if not original_tags:
            continue
        filtered_tags = [value for value in original_tags if value != tag.id]
        if filtered_tags == original_tags:
            continue
        payload["tags"] = filtered_tags
        if not filtered_tags:
            payload["tags"] = []
        schedule.payload = payload
        session.add(schedule)

    job_stmt = select(Job).where(Job.type == "publish")
    if owner_id is None:
        job_stmt = job_stmt.where(Job.owner_user_id.is_(None))
    else:
        job_stmt = job_stmt.where(Job.owner_user_id == owner_id)
    jobs = session.exec(job_stmt).all()
    for job in jobs:
        payload = dict(job.payload or {})
        original_tags = list(payload.get("tags") or [])
        if not original_tags:
            continue
        filtered_tags = [value for value in original_tags if value != tag.id]
        if filtered_tags == original_tags:
            continue
        payload["tags"] = filtered_tags
        if not filtered_tags:
            payload["tags"] = []
        job.payload = payload
        session.add(job)

    session.delete(tag)
    session.commit()
    return None


@router.get("/folders", response_model=List[FolderOut])
def list_folders(current_user=Depends(get_current_user), session=Depends(get_session)):
    user_id = current_user["sub"]
    stmt = select(Folder).where(Folder.owner_user_id == user_id).order_by(Folder.name)
    folders = session.exec(stmt).all()
    return [_folder_to_out(folder) for folder in folders]


@router.post(
    "/folders",
    response_model=FolderOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(csrf_protect)],
)
def create_folder(
    folder: FolderCreate,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    user_id = current_user["sub"]
    name = (folder.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Folder name is required")
    instapaper_folder_id = (
        folder.instapaper_folder_id.strip()
        if isinstance(folder.instapaper_folder_id, str) and folder.instapaper_folder_id.strip()
        else None
    )
    record = Folder(
        owner_user_id=user_id,
        name=name,
        instapaper_folder_id=instapaper_folder_id,
    )
    session.add(record)
    try:
        session.commit()
    except IntegrityError as exc:  # pragma: no cover - defensive
        session.rollback()
        logging.warning("Duplicate folder create ignored user=%s name=%s", user_id, name)
        raise HTTPException(status_code=400, detail="Folder already exists") from exc
    session.refresh(record)
    return _folder_to_out(record)


@router.put(
    "/folders/{folder_id}",
    response_model=FolderOut,
    dependencies=[Depends(csrf_protect)],
)
def update_folder(
    folder_id: str,
    payload: FolderUpdate,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    folder = session.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Not found")
    _require_owner_or_permission(
        session,
        current_user,
        owner_user_id=folder.owner_user_id,
        entity_type="folder",
        entity_id=folder.id,
        attempted_action="update",
        permission=PERMISSION_MANAGE_BOOKMARKS,
    )
    owner_id = folder.owner_user_id
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Folder name is required")
        if name != folder.name:
            exists = session.exec(
                select(Folder).where(
                    (Folder.owner_user_id == owner_id)
                    & (Folder.name == name)
                    & (Folder.id != folder_id)
                )
            ).first()
            if exists:
                raise HTTPException(status_code=400, detail="Folder already exists")
            folder.name = name
    if "instapaper_folder_id" in data:
        instapaper_folder_id = data["instapaper_folder_id"]
        if isinstance(instapaper_folder_id, str):
            instapaper_folder_id = instapaper_folder_id.strip() or None
        folder.instapaper_folder_id = instapaper_folder_id
    session.add(folder)
    session.commit()
    session.refresh(folder)
    return _folder_to_out(folder)


@router.delete(
    "/folders/{folder_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(csrf_protect)],
)
def delete_folder(folder_id: str, current_user=Depends(get_current_user), session=Depends(get_session)):
    folder = session.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Not found")
    _require_owner_or_permission(
        session,
        current_user,
        owner_user_id=folder.owner_user_id,
        entity_type="folder",
        entity_id=folder.id,
        attempted_action="delete",
        permission=PERMISSION_MANAGE_BOOKMARKS,
    )
    owner_id = folder.owner_user_id

    feed_stmt = select(Feed).where(Feed.folder_id == folder.id)
    if owner_id is None:
        feed_stmt = feed_stmt.where(Feed.owner_user_id.is_(None))
    else:
        feed_stmt = feed_stmt.where(Feed.owner_user_id == owner_id)
    feeds = session.exec(feed_stmt).all()
    for feed in feeds:
        feed.folder_id = None
        session.add(feed)

    schedule_stmt = select(JobSchedule).where(JobSchedule.job_type == "publish")
    if owner_id is None:
        schedule_stmt = schedule_stmt.where(JobSchedule.owner_user_id.is_(None))
    else:
        schedule_stmt = schedule_stmt.where(JobSchedule.owner_user_id == owner_id)
    schedules = session.exec(schedule_stmt).all()
    for schedule in schedules:
        payload = dict(schedule.payload or {})
        folder_value = payload.get("folder_id")
        if folder_value != folder.id:
            continue
        payload.pop("folder_id", None)
        schedule.payload = payload
        session.add(schedule)

    job_stmt = select(Job).where(Job.type == "publish")
    if owner_id is None:
        job_stmt = job_stmt.where(Job.owner_user_id.is_(None))
    else:
        job_stmt = job_stmt.where(Job.owner_user_id == owner_id)
    jobs = session.exec(job_stmt).all()
    for job in jobs:
        payload = dict(job.payload or {})
        folder_value = payload.get("folder_id")
        if folder_value != folder.id:
            continue
        payload.pop("folder_id", None)
        job.payload = payload
        session.add(job)

    session.delete(folder)
    session.commit()
    return None






@router.get("/{bookmark_id}/preview", response_class=HTMLResponse)
def preview_bookmark(
    bookmark_id: str,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    bm = session.get(Bookmark, bookmark_id)
    if not bm:
        raise HTTPException(status_code=404, detail="Not found")
    _require_owner_or_permission(
        session,
        current_user,
        owner_user_id=bm.owner_user_id,
        entity_type="bookmark",
        entity_id=bm.id,
        attempted_action="preview",
        permission=PERMISSION_READ_BOOKMARKS,
    )
    preview_url = _resolve_preview_source(bm)
    if not preview_url:
        raise HTTPException(status_code=404, detail="No content available for preview")
    try:
        raw_html = _fetch_html(preview_url)
    except (httpx.HTTPStatusError, httpx.RequestError) as exc:
        logging.warning(
            "Failed to fetch bookmark preview bookmark_id=%s url=%s: %s",
            bookmark_id,
            preview_url,
            exc,
        )
        raise HTTPException(status_code=502, detail="Unable to fetch bookmark content") from exc
    except Exception as exc:  # pragma: no cover - defensive
        logging.exception(
            "Unexpected error fetching bookmark preview bookmark_id=%s url=%s",
            bookmark_id,
            preview_url,
        )
        raise HTTPException(status_code=502, detail="Unable to fetch bookmark content") from exc
    sanitized = _sanitize_html_content(raw_html)
    return HTMLResponse(content=sanitized or "")


@router.get("/{bookmark_id}", response_model=BookmarkOut)
def get_bookmark(bookmark_id: str, current_user=Depends(get_current_user), session=Depends(get_session)):
    bm = session.get(Bookmark, bookmark_id)
    if not bm:
        raise HTTPException(status_code=404, detail="Not found")
    _require_owner_or_permission(
        session,
        current_user,
        owner_user_id=bm.owner_user_id,
        entity_type="bookmark",
        entity_id=bm.id,
        attempted_action="read",
        permission=PERMISSION_READ_BOOKMARKS,
    )
    published_value = bm.published_at
    if isinstance(published_value, datetime):
        published_str = published_value.isoformat()
    elif isinstance(published_value, str):
        published_str = published_value
    else:
        published_str = None
    return BookmarkOut(
        id=bm.id,
        instapaper_bookmark_id=bm.instapaper_bookmark_id,
        title=bm.title,
        url=bm.url,
        content_location=bm.content_location,
        feed_id=bm.feed_id,
        published_at=published_str,
        rss_entry=bm.rss_entry or {},
        raw_html_content=bm.raw_html_content,
        publication_statuses=bm.publication_statuses or {},
        publication_flags=bm.publication_flags or {},
    )


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


def _resolve_config_dir(body: dict) -> str:
    explicit = body.get("config_dir") or body.get("configDir")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    for key in ("SPF_CONFIG_DIR", "SUBPAPERFLUX_CONFIG_DIR", "CONFIG_DIR"):
        value = os.getenv(key)
        if value:
            return value
    return "."


def _normalise_tags(raw: object) -> Optional[List[str]]:
    if isinstance(raw, list):
        return [str(v) for v in raw if isinstance(v, (str, int, float))]
    if isinstance(raw, str):
        parts = [p.strip() for p in raw.split(",")]
        return [p for p in parts if p]
    return None


def _normalise_tag_ids(raw: object) -> Optional[List[str]]:
    if raw is None:
        return None
    values: Iterable = ()
    if isinstance(raw, list):
        values = raw
    elif isinstance(raw, str):
        values = [part.strip() for part in raw.split(",") if part.strip()]
    else:
        return None
    normalized: List[str] = []
    seen: set[str] = set()
    for value in values:
        text = str(value).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        normalized.append(text)
    return normalized


def _encode_event(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"


async def _bulk_publish_event_stream(
    *,
    request: Request,
    user_id: str,
    items: List[dict],
    config_dir: str,
    instapaper_id: str,
    session,
) -> AsyncGenerator[str, None]:
    success = 0
    failed = 0
    feed_cache: Dict[str, Optional[Feed]] = {}
    feed_tag_cache: Dict[str, List[str]] = {}
    folder_cache: Dict[str, Optional[Folder]] = {}
    tag_name_cache: Dict[str, Optional[str]] = {}
    folder_map: Optional[Dict[str, Optional[str]]] = None

    yield _encode_event({"type": "start", "total": len(items)})
    try:
        for index, item in enumerate(items, start=1):
            if await request.is_disconnected():
                logging.info("Client disconnected from bulk publish stream user=%s", user_id)
                return
            item_id = str(item.get("id") or index)
            yield _encode_event({"type": "item", "id": item_id, "status": "pending"})

            bookmark: Optional[Bookmark] = None
            bookmark_identifier = item.get("bookmark_id") or item.get("bookmarkId")
            if bookmark_identifier:
                bookmark = session.get(Bookmark, str(bookmark_identifier))
                if not bookmark or bookmark.owner_user_id != user_id:
                    failed += 1
                    yield _encode_event(
                        {
                            "type": "item",
                            "id": item_id,
                            "status": "failure",
                            "message": "Bookmark not found or unauthorized",
                        }
                    )
                    continue

            raw_url = item.get("url")
            url = raw_url.strip() if isinstance(raw_url, str) else None
            if not url and bookmark and isinstance(bookmark.url, str):
                url = bookmark.url
            if not url:
                failed += 1
                yield _encode_event(
                    {
                        "type": "item",
                        "id": item_id,
                        "status": "failure",
                        "message": "Missing URL",
                    }
                )
                continue

            publish_kwargs: Dict[str, Any] = {
                "owner_user_id": user_id,
                "config_dir": config_dir,
            }

            raw_title = item.get("title")
            title = raw_title.strip() if isinstance(raw_title, str) else None
            if not title and bookmark and isinstance(bookmark.title, str):
                title = bookmark.title
            if title:
                publish_kwargs["title"] = title

            raw_html = item.get("raw_html_content") or item.get("rawHtmlContent")
            if not raw_html and bookmark and isinstance(bookmark.raw_html_content, str):
                raw_html = bookmark.raw_html_content
            if isinstance(raw_html, str) and raw_html:
                publish_kwargs["raw_html_content"] = raw_html

            feed_identifier = item.get("feed_id") or item.get("feedId")
            if feed_identifier is None and bookmark and bookmark.feed_id:
                feed_identifier = bookmark.feed_id
            feed_id = str(feed_identifier).strip() if feed_identifier not in (None, "") else None

            feed: Optional[Feed] = None
            if feed_id:
                if feed_id in feed_cache:
                    feed = feed_cache[feed_id]
                else:
                    candidate = session.get(Feed, feed_id)
                    if candidate and candidate.owner_user_id == user_id:
                        feed = candidate
                    feed_cache[feed_id] = feed

            feed_tag_ids: List[str] = []
            if feed and feed.id:
                cached_ids = feed_tag_cache.get(feed.id)
                if cached_ids is None:
                    cached_ids = get_ordered_feed_tag_ids(session, feed.id)
                    feed_tag_cache[feed.id] = cached_ids
                feed_tag_ids = list(cached_ids)

            item_tag_ids = _normalise_tag_ids(item.get("tag_ids") or item.get("tagIds")) or []

            combined_tag_ids: List[str] = []
            if feed_tag_ids:
                combined_tag_ids.extend(feed_tag_ids)
            if item_tag_ids:
                combined_tag_ids.extend(item_tag_ids)

            tag_names = translate_tag_ids_to_names(
                session,
                user_id,
                combined_tag_ids,
                cache=tag_name_cache,
            )

            direct_tag_names = _normalise_tags(item.get("tags"))
            if direct_tag_names:
                for name in direct_tag_names:
                    if name not in tag_names:
                        tag_names.append(name)

            folder_override = item.get("folder_id") or item.get("folderId")
            if folder_override not in (None, ""):
                folder_override = str(folder_override).strip() or None
            else:
                folder_override = None

            folder = resolve_effective_folder(
                session,
                feed=feed,
                schedule_folder_id=folder_override,
                cache=folder_cache,
            )
            if folder and folder.owner_user_id != user_id:
                folder = None
            folder_name: Optional[str] = None
            remote_folder_id: Optional[str] = None
            if folder:
                folder_name = folder.name
                if folder_map is None:
                    folder_map = sync_instapaper_folders(
                        session,
                        instapaper_credential_id=str(instapaper_id),
                        owner_user_id=user_id,
                        config_dir=config_dir,
                    )
                session.refresh(folder)
                remote_folder_id = (folder_map or {}).get(folder.id) or folder.instapaper_folder_id
            else:
                raw_folder_name = item.get("folder")
                if isinstance(raw_folder_name, str) and raw_folder_name.strip():
                    folder_name = raw_folder_name.strip()

            if folder_name:
                publish_kwargs["folder"] = folder_name
            if remote_folder_id:
                publish_kwargs["folder_id"] = remote_folder_id
            if tag_names:
                publish_kwargs["tags"] = tag_names

            try:
                result = await asyncio.to_thread(
                    publish_url,
                    str(instapaper_id),
                    url,
                    **publish_kwargs,
                )
            except Exception as exc:  # noqa: BLE001 - surface raw error to caller
                logging.exception("Bulk publish failed for url=%s user=%s", url, user_id)
                failed += 1
                yield _encode_event(
                    {
                        "type": "item",
                        "id": item_id,
                        "status": "failure",
                        "message": str(exc),
                    }
                )
                continue

            success += 1
            event_payload = {"type": "item", "id": item_id, "status": "success"}
            if isinstance(result, dict):
                event_payload["result"] = result
            yield _encode_event(event_payload)
    except asyncio.CancelledError:  # pragma: no cover - handled by server internals
        logging.info("Bulk publish stream cancelled for user=%s", user_id)
        raise
    except Exception as exc:  # pragma: no cover - defensive catch
        logging.exception("Bulk publish stream aborted for user=%s", user_id)
        yield _encode_event({"type": "error", "message": str(exc)})
        return

    yield _encode_event({"type": "complete", "success": success, "failed": failed})


@router.post("/bulk-publish", dependencies=[Depends(csrf_protect)])
async def bulk_publish_bookmarks(
    body: dict,
    request: Request,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    items = body.get("items") or []
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=400, detail="items list required")

    user_id = current_user["sub"]
    config_dir = _resolve_config_dir(body)

    instapaper_id = body.get("instapaper_cred_id") or body.get("instapaper_id")
    credential: Optional[Credential] = None
    if instapaper_id:
        credential = session.get(Credential, str(instapaper_id))
        if not credential or credential.kind != "instapaper" or credential.owner_user_id != user_id:
            raise HTTPException(status_code=400, detail="Invalid Instapaper credential")
    else:
        stmt = select(Credential).where(
            (Credential.owner_user_id == user_id) & (Credential.kind == "instapaper")
        )
        credential = session.exec(stmt).first()
        if not credential:
            raise HTTPException(status_code=400, detail="No Instapaper credential configured")
        instapaper_id = credential.id
    stream = _bulk_publish_event_stream(
        request=request,
        user_id=user_id,
        items=items,
        config_dir=config_dir,
        instapaper_id=str(instapaper_id),
        session=session,
    )
    headers = {"Cache-Control": "no-cache"}
    return StreamingResponse(stream, media_type="application/x-ndjson", headers=headers)


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
    actor_id = _get_request_user_id(current_user)
    enforcement_enabled = is_user_mgmt_enforce_enabled()
    oauth_cache: dict[str, Optional[object]] = {} if delete_remote else {}
    for bid in ids:
        bm = session.get(Bookmark, str(bid))
        if not bm:
            continue
        if enforcement_enabled:
            _require_owner_or_permission(
                session,
                current_user,
                owner_user_id=bm.owner_user_id,
                entity_type="bookmark",
                entity_id=bm.id,
                attempted_action="bulk_delete",
                permission=PERMISSION_MANAGE_BOOKMARKS,
                mask_as_not_found=False,
                forbidden_detail=f"Forbidden bookmark ID: {bm.id}",
            )
        elif bm.owner_user_id != actor_id:
            continue

        oauth = None
        if delete_remote and bm.instapaper_bookmark_id:
            oauth = oauth_cache.get(bm.owner_user_id)
            if bm.owner_user_id not in oauth_cache:
                oauth = get_instapaper_oauth_session(bm.owner_user_id)
                oauth_cache[bm.owner_user_id] = oauth
            if oauth:
                try:
                    resp = oauth.post(
                        INSTAPAPER_BOOKMARKS_DELETE_URL,
                        data={"bookmark_id": bm.instapaper_bookmark_id},
                    )
                    resp.raise_for_status()
                except Exception:
                    pass
        record_audit_log(
            session,
            entity_type="bookmark",
            entity_id=bm.id,
            action="delete",
            owner_user_id=bm.owner_user_id,
            actor_user_id=actor_id,
            details={
                "instapaper_bookmark_id": bm.instapaper_bookmark_id,
                "bulk": True,
                "delete_remote": bool(delete_remote),
            },
        )
        session.delete(bm)
    session.commit()
    return None
