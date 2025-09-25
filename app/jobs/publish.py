import logging

from ..audit import record_audit_log
from ..jobs import register_handler
from .util_subpaperflux import publish_url
from ..db import get_session_ctx
from ..models import Bookmark
from datetime import datetime, timezone
from typing import Dict, Any


def handle_publish(*, job_id: str, owner_user_id: str | None, payload: dict) -> Dict[str, Any]:
    # Expected payload: {"config_dir": str, "instapaper_id": str, "url": str, "title": str | None, "folder": str | None, "tags": [str]}
    config_dir = payload.get("config_dir")
    instapaper_id = payload.get("instapaper_id")
    url = payload.get("url")
    title = payload.get("title")
    folder = payload.get("folder")
    tags = payload.get("tags")
    if not all([config_dir, instapaper_id, url]):
        raise ValueError("config_dir, instapaper_id, and url are required")
    logging.info("[job:%s] Publish to Instapaper user=%s url=%s title=%s", job_id, owner_user_id, url, title)
    res = publish_url(config_dir, instapaper_id, url, title=title, folder=folder, tags=tags, owner_user_id=owner_user_id)
    if res and not res.get("deduped"):
        with get_session_ctx() as session:
            published_at = payload.get("published_at")
            if isinstance(published_at, str):
                try:
                    published_at = datetime.fromisoformat(published_at)
                except Exception:
                    published_at = None
            publication_recorded_at = datetime.now(timezone.utc).isoformat()
            publication_statuses = {
                "instapaper": {
                    "status": "published",
                    "bookmark_id": str(res.get("bookmark_id")),
                    "content_location": res.get("content_location"),
                    "published_at": publication_recorded_at,
                }
            }
            publication_flags = {
                "instapaper": {
                    "should_publish": True,
                    "credential_id": instapaper_id,
                    "created_at": publication_recorded_at,
                    "last_seen_at": publication_recorded_at,
                    "has_raw_html": bool(payload.get("raw_html_content")),
                }
            }
            bm = Bookmark(
                owner_user_id=owner_user_id,
                instapaper_bookmark_id=str(res.get("bookmark_id")),
                url=url,
                title=res.get("title") or title,
                content_location=res.get("content_location"),
                feed_id=payload.get("feed_id"),
                published_at=published_at,
                rss_entry=payload.get("rss_entry") or {},
                raw_html_content=payload.get("raw_html_content"),
                publication_statuses=publication_statuses,
                publication_flags=publication_flags,
            )
            session.add(bm)
            record_audit_log(
                session,
                entity_type="bookmark",
                entity_id=bm.id,
                action="create",
                owner_user_id=bm.owner_user_id,
                actor_user_id=owner_user_id,
                details={
                    "instapaper_bookmark_id": bm.instapaper_bookmark_id,
                    "job_id": job_id,
                    "source": "publish_job",
                    "publication_statuses": publication_statuses,
                    "publication_flags": publication_flags,
                },
            )
            session.commit()
    return res


register_handler("publish", handle_publish)
