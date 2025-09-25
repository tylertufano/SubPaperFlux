import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional, Tuple

from sqlmodel import select

from ..audit import record_audit_log
from ..integrations.instapaper import INSTAPAPER_BOOKMARKS_DELETE_URL
from ..jobs import register_handler
from ..db import get_session_ctx
from ..models import Bookmark
from .util_subpaperflux import get_instapaper_oauth_session_for_id


def _seconds_from_spec(spec: str) -> int:
    import re

    v = int(re.findall(r"\d+", spec)[0])
    u = re.findall(r"[a-z]", spec)[0].lower()
    return v if u == "s" else v * 60 if u == "m" else v * 3600 if u == "h" else v * 86400


def _parse_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        cleaned = value.strip()
        if cleaned.endswith("Z"):
            cleaned = cleaned[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(cleaned)
        except ValueError:
            return None
    else:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _extract_instapaper_publication(
    bookmark: Bookmark,
    *,
    credential_id: str,
) -> Optional[Tuple[str, datetime, Dict[str, Any]]]:
    statuses = bookmark.publication_statuses or {}
    instapaper_status = statuses.get("instapaper") or {}
    if instapaper_status.get("status") != "published":
        return None
    status_cred = instapaper_status.get("credential_id")
    if status_cred and status_cred != credential_id:
        return None
    bookmark_id = instapaper_status.get("bookmark_id") or bookmark.instapaper_bookmark_id
    if not bookmark_id:
        return None
    published_ts = _parse_datetime(instapaper_status.get("published_at") or bookmark.published_at)
    if not published_ts:
        return None
    return str(bookmark_id), published_ts, instapaper_status


def handle_retention(*, job_id: str, owner_user_id: str | None, payload: dict) -> Dict[str, Any]:
    # Expected payload: {"older_than": "30d", "instapaper_id": str, "feed_id": str | None, "config_dir": str | None}
    older_than = payload.get("older_than", "30d")
    instapaper_id = payload.get("instapaper_credential_id") or payload.get("instapaper_id")
    feed_id = payload.get("feed_id")
    config_dir = payload.get("config_dir")
    if not instapaper_id:
        raise ValueError("instapaper_id is required")
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=_seconds_from_spec(older_than))
    logging.info(
        "[job:%s] Retention purge user=%s older_than=%s feed_id=%s instapaper_cred=%s (cutoff=%s)",
        job_id,
        owner_user_id,
        older_than,
        feed_id,
        instapaper_id,
        cutoff.isoformat(),
    )

    # Collect candidate bookmarks from DB
    with get_session_ctx() as session:
        stmt = select(Bookmark).where(Bookmark.owner_user_id == owner_user_id)
        if feed_id:
            stmt = stmt.where(Bookmark.feed_id == feed_id)
        rows = session.exec(stmt).all()

    # Build OAuth session
    oauth = get_instapaper_oauth_session_for_id(instapaper_id, owner_user_id, config_dir=config_dir)
    if oauth is None:
        logging.warning("[job:%s] No Instapaper credentials or app creds found; skipping retention.", job_id)
        return {"deleted_count": 0}

    # Delete older bookmarks in Instapaper then remove from DB
    to_delete = []
    for b in rows:
        extraction = _extract_instapaper_publication(b, credential_id=instapaper_id)
        if not extraction:
            continue
        bookmark_id, published_ts, instapaper_status = extraction
        if published_ts <= cutoff:
            to_delete.append((b, bookmark_id, instapaper_status))

    deleted = 0
    from ..util.ratelimit import limiter
    with get_session_ctx() as session:
        for db_bookmark, bookmark_id, instapaper_status in to_delete:
            try:
                limiter.wait("instapaper")
                resp = oauth.post(INSTAPAPER_BOOKMARKS_DELETE_URL, data={"bookmark_id": bookmark_id})
                resp.raise_for_status()
                persistent = session.get(Bookmark, db_bookmark.id)
                if persistent:
                    record_audit_log(
                        session,
                        entity_type="bookmark",
                        entity_id=persistent.id,
                        action="delete",
                        owner_user_id=persistent.owner_user_id,
                        actor_user_id=owner_user_id,
                        details={
                            "instapaper_bookmark_id": persistent.instapaper_bookmark_id,
                            "job_id": job_id,
                            "source": "retention_job",
                            "cutoff": cutoff.isoformat(),
                            "publication_status": instapaper_status,
                        },
                    )
                    session.delete(persistent)
                    session.commit()
                    deleted += 1
            except Exception as e:  # noqa: BLE001
                logging.warning("[job:%s] Failed to delete bookmark %s: %s", job_id, bookmark_id, e)

    logging.info("[job:%s] Retention purge deleted %d bookmarks", job_id, deleted)
    return {"deleted_count": deleted}


register_handler("retention", handle_retention)
