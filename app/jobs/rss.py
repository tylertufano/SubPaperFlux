import logging
from typing import Any, Dict

from ..jobs import register_handler
from ..jobs.validation import scrub_legacy_schedule_payload
from .util_subpaperflux import poll_rss_and_publish


def handle_rss_poll(*, job_id: str, owner_user_id: str | None, payload: dict) -> Dict[str, Any]:
    # Expected payload: {"feed_id": str, "instapaper_id": str | None}
    sanitized_payload = scrub_legacy_schedule_payload(payload)
    if "lookback" in (payload or {}):
        logging.debug("Ignoring deprecated 'lookback' key in RSS poll payload")

    if not (sanitized_payload.get("feed_id")):
        raise ValueError("feed_id is required")
    instapaper_id = sanitized_payload.get("instapaper_id") or None
    # Feed-level configuration determines paywall/authentication behavior.
    res = poll_rss_and_publish(
        instapaper_id=instapaper_id,
        feed_id=sanitized_payload["feed_id"],
        owner_user_id=owner_user_id,
    )
    logging.info(
        "[job:%s] RSS poll stored %d/%d entries (duplicates=%d)",
        job_id,
        res.get("stored"),
        res.get("total"),
        res.get("duplicates", 0),
    )
    return res


register_handler("rss_poll", handle_rss_poll)
