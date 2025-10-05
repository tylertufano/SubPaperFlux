import logging

from typing import Any, Dict, List, Optional

from ..audit import record_audit_log
from ..db import get_session_ctx
from ..jobs import register_handler
from ..models import (
    Feed as FeedModel,
    Folder as FolderModel,
    Job as JobModel,
    JobSchedule as JobScheduleModel,
)
from .util_subpaperflux import (
    apply_publication_result,
    get_ordered_feed_tag_ids,
    iter_pending_instapaper_bookmarks,
    publish_url,
    resolve_effective_folder,
    sync_instapaper_folders,
    translate_tag_ids_to_names,
)


def _normalise_limit(value: Any) -> Optional[int]:
    if value in (None, "", False):
        return None
    try:
        limit = int(value)
    except (TypeError, ValueError):
        return None
    return limit if limit >= 0 else None


def handle_publish(*, job_id: str, owner_user_id: str | None, payload: dict) -> Dict[str, Any]:
    instapaper_id = payload.get("instapaper_id")
    if not instapaper_id:
        raise ValueError("instapaper_id is required")

    raw_feed_id = payload.get("feed_id")
    feed_id: Optional[str]
    if raw_feed_id in (None, ""):
        feed_id = None
    else:
        feed_id = str(raw_feed_id)

    limit = _normalise_limit(
        payload.get("limit")
        or payload.get("max_items")
        or payload.get("max_entries")
        or payload.get("max_per_run")
    )
    include_paywalled = payload.get("include_paywalled")
    if include_paywalled not in (None, ""):
        include_paywalled = bool(include_paywalled)
    else:
        include_paywalled = None
    config_dir = payload.get("config_dir")

    feed_for_log = feed_id or "all feeds"

    logging.info(
        "[job:%s] Publish pending bookmarks user=%s instapaper=%s feed=%s limit=%s",
        job_id,
        owner_user_id,
        instapaper_id,
        feed_for_log,
        limit,
    )

    result: Dict[str, Any] = {"attempted": 0, "published": [], "failed": []}

    with get_session_ctx() as session:
        job_record = session.get(JobModel, job_id)
        schedule_payload: Dict[str, Any] = {}
        if job_record and isinstance(job_record.details, dict):
            schedule_id = job_record.details.get("schedule_id")
            if schedule_id:
                schedule = session.get(JobScheduleModel, schedule_id)
                if schedule and schedule.job_type == "publish":
                    schedule_payload = dict(schedule.payload or {})
        if not schedule_payload:
            schedule_payload = dict(payload or {})

        raw_schedule_tags = schedule_payload.get("tags") or []
        schedule_tag_ids: List[str] = []
        for raw_tag in raw_schedule_tags:
            text = str(raw_tag).strip()
            if text:
                schedule_tag_ids.append(text)
        schedule_folder_id_value = schedule_payload.get("folder_id")
        if schedule_folder_id_value is None:
            schedule_folder_id: Optional[str] = None
        else:
            schedule_folder_id = str(schedule_folder_id_value).strip() or None

        feed_cache: Dict[str, Optional[FeedModel]] = {}
        feed_tag_cache: Dict[str, List[str]] = {}
        folder_cache: Dict[str, Optional[FolderModel]] = {}
        tag_name_cache: Dict[str, Optional[str]] = {}
        folder_map: Optional[Dict[str, Optional[str]]] = None

        pending = iter_pending_instapaper_bookmarks(
            session,
            owner_user_id=owner_user_id,
            instapaper_id=str(instapaper_id),
            feed_id=feed_id,
            limit=limit,
            include_paywalled=include_paywalled,
        )
        if not pending:
            logging.info(
                "[job:%s] No pending bookmarks for instapaper=%s feed=%s",
                job_id,
                instapaper_id,
                feed_for_log,
            )
            return {**result, "remaining": 0}

        result["attempted"] = len(pending)
        published_entries: List[Dict[str, Any]] = []
        failed_entries: List[Dict[str, Any]] = []

        for bookmark in pending:
            if not bookmark.url:
                error = ValueError("bookmark missing URL")
                instapaper_status, instapaper_flags = apply_publication_result(
                    bookmark,
                    instapaper_id=str(instapaper_id),
                    job_id=job_id,
                    error=error,
                )
                failed_entries.append(
                    {"bookmark_id": bookmark.id, "error": str(error)}
                )
                record_audit_log(
                    session,
                    entity_type="bookmark",
                    entity_id=bookmark.id,
                    action="update",
                    owner_user_id=bookmark.owner_user_id,
                    actor_user_id=owner_user_id,
                    details={
                        "job_id": job_id,
                        "source": "publish_job",
                        "publication_status": instapaper_status,
                        "publication_flags": instapaper_flags,
                        "error": str(error),
                    },
                )
                session.add(bookmark)
                continue

            feed: Optional[FeedModel] = None
            feed_key = str(bookmark.feed_id) if bookmark.feed_id else None
            if feed_key:
                if feed_key in feed_cache:
                    feed = feed_cache[feed_key]
                else:
                    feed = session.get(FeedModel, feed_key)
                    feed_cache[feed_key] = feed
            feed_tag_ids: List[str] = []
            if feed and feed.id:
                cached_ids = feed_tag_cache.get(feed.id)
                if cached_ids is None:
                    cached_ids = get_ordered_feed_tag_ids(session, feed.id)
                    feed_tag_cache[feed.id] = cached_ids
                feed_tag_ids = list(cached_ids)

            combined_tag_ids: List[str] = []
            if feed_tag_ids:
                combined_tag_ids.extend(feed_tag_ids)
            if schedule_tag_ids:
                combined_tag_ids.extend(schedule_tag_ids)

            tag_names = translate_tag_ids_to_names(
                session,
                owner_user_id,
                combined_tag_ids,
                cache=tag_name_cache,
            )

            folder = resolve_effective_folder(
                session,
                feed=feed,
                schedule_folder_id=schedule_folder_id,
                cache=folder_cache,
            )
            remote_folder_id: Optional[str] = None
            folder_name: Optional[str] = None
            if folder is not None:
                folder_name = folder.name
                if folder_map is None:
                    folder_map = sync_instapaper_folders(
                        session,
                        instapaper_credential_id=str(instapaper_id),
                        owner_user_id=owner_user_id,
                        config_dir=config_dir,
                    )
                session.refresh(folder)
                remote_folder_id = (folder_map or {}).get(folder.id) or folder.instapaper_folder_id

            try:
                publish_res = publish_url(
                    str(instapaper_id),
                    bookmark.url,
                    title=bookmark.title,
                    tags=tag_names if tag_names else None,
                    folder=folder_name,
                    folder_id=remote_folder_id,
                    owner_user_id=owner_user_id,
                    config_dir=config_dir,
                    raw_html_content=bookmark.raw_html_content,
                )
                instapaper_status, instapaper_flags = apply_publication_result(
                    bookmark,
                    instapaper_id=str(instapaper_id),
                    job_id=job_id,
                    result=publish_res,
                )
                published_entries.append(
                    {
                        "bookmark_id": bookmark.id,
                        "instapaper_bookmark_id": instapaper_status.get("bookmark_id"),
                        "deduped": bool(instapaper_status.get("deduped")),
                    }
                )
                record_audit_log(
                    session,
                    entity_type="bookmark",
                    entity_id=bookmark.id,
                    action="update",
                    owner_user_id=bookmark.owner_user_id,
                    actor_user_id=owner_user_id,
                    details={
                        "job_id": job_id,
                        "source": "publish_job",
                        "publication_status": instapaper_status,
                        "publication_flags": instapaper_flags,
                        "result": publish_res,
                    },
                )
            except Exception as exc:  # noqa: BLE001
                logging.exception(
                    "[job:%s] Failed to publish bookmark=%s", job_id, bookmark.id
                )
                instapaper_status, instapaper_flags = apply_publication_result(
                    bookmark,
                    instapaper_id=str(instapaper_id),
                    job_id=job_id,
                    error=exc,
                )
                failed_entries.append(
                    {"bookmark_id": bookmark.id, "error": str(exc)}
                )
                record_audit_log(
                    session,
                    entity_type="bookmark",
                    entity_id=bookmark.id,
                    action="update",
                    owner_user_id=bookmark.owner_user_id,
                    actor_user_id=owner_user_id,
                    details={
                        "job_id": job_id,
                        "source": "publish_job",
                        "publication_status": instapaper_status,
                        "publication_flags": instapaper_flags,
                        "error": str(exc),
                    },
                )
            session.add(bookmark)

        session.commit()

        remaining = iter_pending_instapaper_bookmarks(
            session,
            owner_user_id=owner_user_id,
            instapaper_id=str(instapaper_id),
            feed_id=feed_id,
        )

    result["published"] = published_entries
    result["failed"] = failed_entries
    result["remaining"] = len(remaining)

    logging.info(
        "[job:%s] Publish summary attempted=%s published=%s failed=%s remaining=%s",
        job_id,
        result["attempted"],
        len(published_entries),
        len(failed_entries),
        result["remaining"],
    )

    return result


register_handler("publish", handle_publish)
