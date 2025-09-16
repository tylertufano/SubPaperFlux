import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any

from sqlmodel import select

from ..audit import record_audit_log
from ..jobs import register_handler
from ..db import get_session_ctx
from ..models import Bookmark
from .util_subpaperflux import get_instapaper_oauth_session


def _seconds_from_spec(spec: str) -> int:
    import re
    v = int(re.findall(r"\d+", spec)[0])
    u = re.findall(r"[a-z]", spec)[0].lower()
    return v if u == "s" else v*60 if u == "m" else v*3600 if u == "h" else v*86400


def _get_instapaper_oauth(owner_user_id: str | None):
    return get_instapaper_oauth_session(owner_user_id)


def handle_retention(*, job_id: str, owner_user_id: str | None, payload: dict) -> Dict[str, Any]:
    # Expected payload: {"older_than": "30d"}
    older_than = payload.get("older_than", "30d")
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=_seconds_from_spec(older_than))
    logging.info("[job:%s] Retention purge user=%s older_than=%s (cutoff=%s)", job_id, owner_user_id, older_than, cutoff.isoformat())

    # Collect candidate bookmarks from DB
    with get_session_ctx() as session:
        stmt = select(Bookmark).where(Bookmark.owner_user_id == owner_user_id)
        rows = session.exec(stmt).all()

    # Build OAuth session
    oauth = _get_instapaper_oauth(owner_user_id)
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
