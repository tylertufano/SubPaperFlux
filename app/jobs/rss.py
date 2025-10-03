import logging
from typing import Dict, Any

from ..jobs import register_handler
from .util_subpaperflux import format_site_login_pair_id, poll_rss_and_publish


def handle_rss_poll(*, job_id: str, owner_user_id: str | None, payload: dict) -> Dict[str, Any]:
    # Expected payload: {"feed_id": str, "instapaper_id": str | None,
    #                    "lookback": "24h", "site_login_pair": str | None}
    if not (payload.get("feed_id")):
        raise ValueError("feed_id is required")
    instapaper_id = payload.get("instapaper_id") or None
    site_login_pair = payload.get("site_login_pair")
    if not site_login_pair:
        cred = payload.get("credential_id")
        site_cfg = payload.get("site_config_id")
        if cred and site_cfg:
            site_login_pair = format_site_login_pair_id(str(cred), str(site_cfg))

    # Feed-level configuration determines paywall/authentication behavior.
    res = poll_rss_and_publish(
        instapaper_id=instapaper_id,
        feed_id=payload["feed_id"],
        lookback=payload.get("lookback", "24h"),
        site_login_pair_id=site_login_pair,
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
