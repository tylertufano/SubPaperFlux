import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any

from sqlmodel import select

from ..audit import record_audit_log
from ..jobs import register_handler
from ..db import get_session_ctx
from ..models import Bookmark
from .util_subpaperflux import get_instapaper_oauth_session_for_id


def _seconds_from_spec(spec: str) -> int:
    import re
    v = int(re.findall(r"\d+", spec)[0])
    u = re.findall(r"[a-z]", spec)[0].lower()
    return v if u == "s" else v*60 if u == "m" else v*3600 if u == "h" else v*86400


def handle_retention(*, job_id: str, owner_user_id: str | None, payload: dict) -> Dict[str, Any]:
    # Expected payload: {"older_than": "30d", "instapaper_id": str, "feed_id": str | None, "config_dir": str | None}
    older_than = payload.get("older_than", "30d")
    instapaper_id = payload.get("instapaper_id")
    feed_id = payload.get("feed_id")
    config_dir = payload.get("config_dir")
    if not instapaper_id:
        raise ValueError("instapaper_id is required")
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=_seconds_from_spec(older_than))
    logging.info(
        "[job:%s] Retention purge user=%s older_than=%s feed_id=%s (cutoff=%s)",
        job_id,
        owner_user_id,
        older_than,
        feed_id,
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
        return

    # Delete older bookmarks in Instapaper then remove from DB
    from subpaperflux import INSTAPAPER_BOOKMARKS_DELETE_URL

    to_delete = []
    for b in rows:
        # Fallback: if no published_at, skip
        try:
            if not b.published_at:
                continue
            ts = datetime.fromisoformat(b.published_at)
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if ts <= cutoff:
                to_delete.append(b)
        except Exception:
            continue

    deleted = 0
    from ..util.ratelimit import limiter
    with get_session_ctx() as session:
        for b in to_delete:
            try:
                limiter.wait("instapaper")
                resp = oauth.post(INSTAPAPER_BOOKMARKS_DELETE_URL, data={"bookmark_id": b.instapaper_bookmark_id})
                resp.raise_for_status()
                db_bookmark = session.get(Bookmark, b.id)
                if db_bookmark:
                    record_audit_log(
                        session,
                        entity_type="bookmark",
                        entity_id=db_bookmark.id,
                        action="delete",
                        owner_user_id=db_bookmark.owner_user_id,
                        actor_user_id=owner_user_id,
                        details={
                            "instapaper_bookmark_id": db_bookmark.instapaper_bookmark_id,
                            "job_id": job_id,
                            "source": "retention_job",
                            "cutoff": cutoff.isoformat(),
                        },
                    )
                    session.delete(db_bookmark)
                    session.commit()
                    deleted += 1
            except Exception as e:  # noqa: BLE001
                logging.warning("[job:%s] Failed to delete bookmark %s: %s", job_id, b.instapaper_bookmark_id, e)

    logging.info("[job:%s] Retention purge deleted %d bookmarks", job_id, deleted)
    return {"deleted_count": deleted}


register_handler("retention", handle_retention)
