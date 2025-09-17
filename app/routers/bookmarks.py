import asyncio
import difflib
import json
import logging
import os
import re
import shlex
from dataclasses import dataclass
from datetime import datetime
from typing import AsyncGenerator, List, Optional
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
from ..auth.oidc import get_current_user
from ..db import get_session
from ..db import is_postgres
from ..models import (
    Bookmark,
    BookmarkFolderLink,
    BookmarkTagLink,
    Credential,
    Folder,
    Tag,
)
from ..jobs.publish import handle_publish
from ..jobs.util_subpaperflux import get_instapaper_oauth_session
from ..schemas import (
    BookmarkFolderUpdate,
    BookmarkOut,
    BookmarkTagsUpdate,
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
    tag_id: Optional[str] = None,
    folder_id: Optional[str] = None,
):
    stmt = stmt.where(Bookmark.owner_user_id == user_id)
    if feed_id:
        stmt = stmt.where(Bookmark.feed_id == feed_id)
    if since:
        stmt = stmt.where(Bookmark.published_at >= since)
    if until:
        stmt = stmt.where(Bookmark.published_at <= until)
    if tag_id:
        tag_subquery = select(BookmarkTagLink.bookmark_id).where(BookmarkTagLink.tag_id == tag_id)
        stmt = stmt.where(Bookmark.id.in_(tag_subquery))
    if folder_id:
        folder_subquery = select(BookmarkFolderLink.bookmark_id).where(
            BookmarkFolderLink.folder_id == folder_id
        )
        stmt = stmt.where(Bookmark.id.in_(folder_subquery))
    return stmt


def _get_bookmark_or_404(session, bookmark_id: str, user_id: str) -> Bookmark:
    bookmark = session.get(Bookmark, bookmark_id)
    if not bookmark or bookmark.owner_user_id != user_id:
        raise HTTPException(status_code=404, detail="Not found")
    return bookmark


def _tag_counts(session, user_id: str) -> dict[str, int]:
    stmt = (
        select(BookmarkTagLink.tag_id, func.count())
        .join(Bookmark, Bookmark.id == BookmarkTagLink.bookmark_id)
        .where(Bookmark.owner_user_id == user_id)
        .group_by(BookmarkTagLink.tag_id)
    )
    return {tag_id: int(count or 0) for tag_id, count in session.exec(stmt).all()}


def _folder_counts(session, user_id: str) -> dict[str, int]:
    stmt = (
        select(BookmarkFolderLink.folder_id, func.count())
        .join(Bookmark, Bookmark.id == BookmarkFolderLink.bookmark_id)
        .where(Bookmark.owner_user_id == user_id)
        .group_by(BookmarkFolderLink.folder_id)
    )
    return {folder_id: int(count or 0) for folder_id, count in session.exec(stmt).all()}


def _tag_to_out(tag: Tag, counts: dict[str, int]) -> TagOut:
    return TagOut(id=tag.id, name=tag.name, bookmark_count=int(counts.get(tag.id, 0)))


def _folder_to_out(folder: Folder, counts: dict[str, int]) -> FolderOut:
    return FolderOut(
        id=folder.id,
        name=folder.name,
        instapaper_folder_id=folder.instapaper_folder_id,
        bookmark_count=int(counts.get(folder.id, 0)),
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
    tag_id: Optional[str] = Query(None),
    folder_id: Optional[str] = Query(None),
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
    base = _apply_filters(base, user_id, feed_id, since, until, tag_id, folder_id)
    # Total count (without pagination)
    count_stmt = select(func.count()).select_from(Bookmark)
    count_stmt = _apply_filters(count_stmt, user_id, feed_id, since, until, tag_id, folder_id)
    total = session.exec(count_stmt).one()

    filters = _collect_filters(search, title_query, url_query, regex, regex_target, regex_flags)
    chosen_sort = sort_by or filters.sort_preference
    similarity_query = _similarity_term(filters)
    use_similarity = bool(similarity_query) and (fuzzy or chosen_sort == "relevance")

    if is_postgres():
        clauses = _sql_clauses(filters)
        stmt = base
        count_stmt = select(func.count()).select_from(Bookmark)
        count_stmt = _apply_filters(count_stmt, user_id, feed_id, since, until, tag_id, folder_id)
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
    record_audit_log(
        session,
        entity_type="bookmark",
        entity_id=bm.id,
        action="delete",
        owner_user_id=bm.owner_user_id,
        actor_user_id=current_user["sub"],
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
    counts = _tag_counts(session, user_id)
    stmt = select(Tag).where(Tag.owner_user_id == user_id).order_by(Tag.name)
    tags = session.exec(stmt).all()
    return [_tag_to_out(tag, counts) for tag in tags]


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
    return TagOut(id=record.id, name=record.name, bookmark_count=0)


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
    user_id = current_user["sub"]
    tag = session.get(Tag, tag_id)
    if not tag or tag.owner_user_id != user_id:
        raise HTTPException(status_code=404, detail="Not found")
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Tag name is required")
    if name != tag.name:
        exists = session.exec(
            select(Tag).where(
                (Tag.owner_user_id == user_id) & (Tag.name == name) & (Tag.id != tag_id)
            )
        ).first()
        if exists:
            raise HTTPException(status_code=400, detail="Tag already exists")
        tag.name = name
    session.add(tag)
    session.commit()
    session.refresh(tag)
    counts = _tag_counts(session, user_id)
    return _tag_to_out(tag, counts)


@router.delete(
    "/tags/{tag_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(csrf_protect)],
)
def delete_tag(tag_id: str, current_user=Depends(get_current_user), session=Depends(get_session)):
    user_id = current_user["sub"]
    tag = session.get(Tag, tag_id)
    if not tag or tag.owner_user_id != user_id:
        raise HTTPException(status_code=404, detail="Not found")
    session.delete(tag)
    session.commit()
    return None


@router.get("/folders", response_model=List[FolderOut])
def list_folders(current_user=Depends(get_current_user), session=Depends(get_session)):
    user_id = current_user["sub"]
    counts = _folder_counts(session, user_id)
    stmt = select(Folder).where(Folder.owner_user_id == user_id).order_by(Folder.name)
    folders = session.exec(stmt).all()
    return [_folder_to_out(folder, counts) for folder in folders]


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
    return _folder_to_out(record, {record.id: 0})


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
    user_id = current_user["sub"]
    folder = session.get(Folder, folder_id)
    if not folder or folder.owner_user_id != user_id:
        raise HTTPException(status_code=404, detail="Not found")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Folder name is required")
        if name != folder.name:
            exists = session.exec(
                select(Folder).where(
                    (Folder.owner_user_id == user_id)
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
    counts = _folder_counts(session, user_id)
    return _folder_to_out(folder, counts)


@router.delete(
    "/folders/{folder_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(csrf_protect)],
)
def delete_folder(folder_id: str, current_user=Depends(get_current_user), session=Depends(get_session)):
    user_id = current_user["sub"]
    folder = session.get(Folder, folder_id)
    if not folder or folder.owner_user_id != user_id:
        raise HTTPException(status_code=404, detail="Not found")
    session.delete(folder)
    session.commit()
    return None


@router.get("/{bookmark_id}/tags", response_model=List[TagOut])
def get_bookmark_tags(
    bookmark_id: str,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    user_id = current_user["sub"]
    _get_bookmark_or_404(session, bookmark_id, user_id)
    counts = _tag_counts(session, user_id)
    stmt = (
        select(Tag)
        .join(BookmarkTagLink, BookmarkTagLink.tag_id == Tag.id)
        .where(BookmarkTagLink.bookmark_id == bookmark_id)
        .order_by(Tag.name)
    )
    tags = session.exec(stmt).all()
    return [_tag_to_out(tag, counts) for tag in tags]


@router.put(
    "/{bookmark_id}/tags",
    response_model=List[TagOut],
    dependencies=[Depends(csrf_protect)],
)
def update_bookmark_tags(
    bookmark_id: str,
    payload: BookmarkTagsUpdate,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    user_id = current_user["sub"]
    _get_bookmark_or_404(session, bookmark_id, user_id)
    unique: List[str] = []
    seen = set()
    for raw in payload.tags:
        if not isinstance(raw, str):
            raise HTTPException(status_code=400, detail="Tag names must be strings")
        name = raw.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Tag names must be non-empty")
        if name not in seen:
            seen.add(name)
            unique.append(name)
    tag_map: dict[str, Tag] = {}
    if unique:
        stmt = select(Tag).where((Tag.owner_user_id == user_id) & (Tag.name.in_(unique)))
        existing = session.exec(stmt).all()
        tag_map = {t.name: t for t in existing}
        for name in unique:
            if name not in tag_map:
                tag = Tag(owner_user_id=user_id, name=name)
                session.add(tag)
                tag_map[name] = tag
    session.exec(delete(BookmarkTagLink).where(BookmarkTagLink.bookmark_id == bookmark_id))
    for name in unique:
        tag = tag_map[name]
        session.add(BookmarkTagLink(bookmark_id=bookmark_id, tag_id=tag.id))
    record_audit_log(
        session,
        entity_type="bookmark",
        entity_id=bookmark_id,
        action="update",
        owner_user_id=user_id,
        actor_user_id=current_user["sub"],
        details={"tags": unique},
    )
    try:
        session.commit()
    except IntegrityError as exc:  # pragma: no cover - defensive
        session.rollback()
        logging.exception("Failed to update bookmark tags user=%s bookmark=%s", user_id, bookmark_id)
        raise HTTPException(status_code=400, detail="Could not update bookmark tags") from exc
    counts = _tag_counts(session, user_id)
    tags = [tag_map[name] for name in unique]
    return [_tag_to_out(tag, counts) for tag in tags]


@router.get("/{bookmark_id}/folder", response_model=Optional[FolderOut])
def get_bookmark_folder(
    bookmark_id: str,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    user_id = current_user["sub"]
    _get_bookmark_or_404(session, bookmark_id, user_id)
    stmt = (
        select(Folder)
        .join(BookmarkFolderLink, BookmarkFolderLink.folder_id == Folder.id)
        .where(
            (BookmarkFolderLink.bookmark_id == bookmark_id)
            & (Folder.owner_user_id == user_id)
        )
    )
    folder = session.exec(stmt).first()
    if not folder:
        return None
    counts = _folder_counts(session, user_id)
    return _folder_to_out(folder, counts)


@router.put(
    "/{bookmark_id}/folder",
    response_model=FolderOut,
    dependencies=[Depends(csrf_protect)],
)
def update_bookmark_folder(
    bookmark_id: str,
    payload: BookmarkFolderUpdate,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    user_id = current_user["sub"]
    _get_bookmark_or_404(session, bookmark_id, user_id)
    if payload.folder_id and payload.folder_name:
        raise HTTPException(status_code=400, detail="Provide either folder_id or folder_name")
    folder: Optional[Folder] = None
    if payload.folder_id:
        folder = session.get(Folder, payload.folder_id)
        if not folder or folder.owner_user_id != user_id:
            raise HTTPException(status_code=400, detail="Invalid folder_id")
    elif payload.folder_name:
        name = payload.folder_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="folder_name must be non-empty")
        folder = session.exec(
            select(Folder).where((Folder.owner_user_id == user_id) & (Folder.name == name))
        ).first()
        if not folder:
            instapaper_folder_id = (
                payload.instapaper_folder_id.strip()
                if isinstance(payload.instapaper_folder_id, str)
                and payload.instapaper_folder_id.strip()
                else None
            )
            folder = Folder(
                owner_user_id=user_id,
                name=name,
                instapaper_folder_id=instapaper_folder_id,
            )
            session.add(folder)
    else:
        raise HTTPException(status_code=400, detail="folder_id or folder_name required")
    session.exec(delete(BookmarkFolderLink).where(BookmarkFolderLink.bookmark_id == bookmark_id))
    session.add(BookmarkFolderLink(bookmark_id=bookmark_id, folder_id=folder.id))
    record_audit_log(
        session,
        entity_type="bookmark",
        entity_id=bookmark_id,
        action="update",
        owner_user_id=user_id,
        actor_user_id=current_user["sub"],
        details={"folder_id": folder.id, "folder_name": folder.name},
    )
    try:
        session.commit()
    except IntegrityError as exc:  # pragma: no cover - defensive
        session.rollback()
        logging.exception("Failed to update bookmark folder user=%s bookmark=%s", user_id, bookmark_id)
        raise HTTPException(status_code=400, detail="Could not update bookmark folder") from exc
    counts = _folder_counts(session, user_id)
    session.refresh(folder)
    return _folder_to_out(folder, counts)


@router.delete(
    "/{bookmark_id}/folder",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(csrf_protect)],
)
def delete_bookmark_folder(
    bookmark_id: str,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    user_id = current_user["sub"]
    _get_bookmark_or_404(session, bookmark_id, user_id)
    existing_link = session.exec(
        select(BookmarkFolderLink).where(BookmarkFolderLink.bookmark_id == bookmark_id)
    ).first()
    folder_id = existing_link.folder_id if existing_link else None
    session.exec(delete(BookmarkFolderLink).where(BookmarkFolderLink.bookmark_id == bookmark_id))
    record_audit_log(
        session,
        entity_type="bookmark",
        entity_id=bookmark_id,
        action="update",
        owner_user_id=user_id,
        actor_user_id=current_user["sub"],
        details={"folder_cleared": True, "previous_folder_id": folder_id},
    )
    session.commit()
    return None


@router.get("/{bookmark_id}/preview", response_class=HTMLResponse)
def preview_bookmark(
    bookmark_id: str,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    bm = session.get(Bookmark, bookmark_id)
    if not bm or bm.owner_user_id != current_user["sub"]:
        raise HTTPException(status_code=404, detail="Not found")
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
    tag_id: Optional[str] = Query(None),
    folder_id: Optional[str] = Query(None),
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
    base = _apply_filters(base, user_id, feed_id, since, until, tag_id, folder_id)
    if is_postgres():
        clauses = _sql_clauses(filters)
        count_stmt = select(func.count()).select_from(Bookmark)
        count_stmt = _apply_filters(count_stmt, user_id, feed_id, since, until, tag_id, folder_id)
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
    tag_id: Optional[str] = Query(None),
    folder_id: Optional[str] = Query(None),
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
    base = _apply_filters(base, user_id, feed_id, since, until, tag_id, folder_id)
    if is_postgres():
        clauses = _sql_clauses(filters)
        count_stmt = select(func.count()).select_from(Bookmark)
        count_stmt = _apply_filters(count_stmt, user_id, feed_id, since, until, tag_id, folder_id)
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
    tag_id: Optional[str] = Query(None),
    folder_id: Optional[str] = Query(None),
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
    base = _apply_filters(base, user_id, feed_id, since, until, tag_id, folder_id)
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


def _encode_event(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"


async def _bulk_publish_event_stream(
    *,
    request: Request,
    user_id: str,
    items: List[dict],
    config_dir: str,
    instapaper_id: str,
) -> AsyncGenerator[str, None]:
    success = 0
    failed = 0
    yield _encode_event({"type": "start", "total": len(items)})
    try:
        for index, item in enumerate(items, start=1):
            if await request.is_disconnected():
                logging.info("Client disconnected from bulk publish stream user=%s", user_id)
                return
            item_id = str(item.get("id") or index)
            yield _encode_event({"type": "item", "id": item_id, "status": "pending"})
            url = item.get("url")
            if not isinstance(url, str) or not url.strip():
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
            payload = {
                "config_dir": config_dir,
                "instapaper_id": instapaper_id,
                "url": url,
            }
            title = item.get("title")
            if isinstance(title, str) and title:
                payload["title"] = title
            folder = item.get("folder")
            if isinstance(folder, str) and folder:
                payload["folder"] = folder
            tags = _normalise_tags(item.get("tags"))
            if tags:
                payload["tags"] = tags
            feed_id = item.get("feed_id") or item.get("feedId")
            if isinstance(feed_id, str) and feed_id:
                payload["feed_id"] = feed_id
            published_at = item.get("published_at") or item.get("publishedAt")
            if isinstance(published_at, str) and published_at:
                payload["published_at"] = published_at
            try:
                result = await asyncio.to_thread(
                    handle_publish,
                    job_id=f"bulk-{uuid4().hex}",
                    owner_user_id=user_id,
                    payload=payload,
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
        record_audit_log(
            session,
            entity_type="bookmark",
            entity_id=bm.id,
            action="delete",
            owner_user_id=bm.owner_user_id,
            actor_user_id=current_user["sub"],
            details={
                "instapaper_bookmark_id": bm.instapaper_bookmark_id,
                "bulk": True,
                "delete_remote": bool(delete_remote),
            },
        )
        session.delete(bm)
    session.commit()
    return None
