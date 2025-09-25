import logging
from typing import Dict, Any

from ..jobs import register_handler
from .util_subpaperflux import poll_rss_and_publish


def handle_rss_poll(*, job_id: str, owner_user_id: str | None, payload: dict) -> Dict[str, Any]:
    # Expected payload: {"config_dir": str, "instapaper_id": str, "feed_url": str,
    #                    "lookback": "24h", "is_paywalled": bool, "rss_requires_auth": bool,
    #                    "site_login_credential_id": str | None}
    required = ["config_dir", "instapaper_id", "feed_url"]
    if not all(k in payload and payload[k] for k in required):
        raise ValueError("config_dir, instapaper_id, and feed_url are required")
    res = poll_rss_and_publish(
        config_dir=payload["config_dir"],
        instapaper_id=payload["instapaper_id"],
        feed_url=payload["feed_url"],
        lookback=payload.get("lookback", "24h"),
        is_paywalled=payload.get("is_paywalled", False),
        rss_requires_auth=payload.get("rss_requires_auth", False),
        site_login_credential_id=payload.get("site_login_credential_id") or payload.get("credential_id"),
        owner_user_id=owner_user_id,
    )
    logging.info("[job:%s] RSS poll published %d/%d entries", job_id, res.get("published"), res.get("total"))
    return res


register_handler("rss_poll", handle_rss_poll)
