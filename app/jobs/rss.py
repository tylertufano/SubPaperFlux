import logging
from typing import Dict, Any

from ..jobs import register_handler
from .util_subpaperflux import format_site_login_pair_id, poll_rss_and_publish


def handle_rss_poll(*, job_id: str, owner_user_id: str | None, payload: dict) -> Dict[str, Any]:
    # Expected payload: {"instapaper_id": str, "feed_id": str,
    #                    "lookback": "24h", "is_paywalled": bool, "rss_requires_auth": bool,
    #                    "site_login_pair": str | None}
    required = ["instapaper_id", "feed_id"]
    if not all(k in payload and payload[k] for k in required):
        raise ValueError("instapaper_id and feed_id are required")
    site_login_pair = payload.get("site_login_pair")
    if not site_login_pair:
        cred = payload.get("credential_id")
        site_cfg = payload.get("site_config_id")
        if cred and site_cfg:
            site_login_pair = format_site_login_pair_id(str(cred), str(site_cfg))

    res = poll_rss_and_publish(
        instapaper_id=payload["instapaper_id"],
        feed_id=payload["feed_id"],
        lookback=payload.get("lookback", "24h"),
        is_paywalled=payload.get("is_paywalled", False),
        rss_requires_auth=payload.get("rss_requires_auth", False),
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
