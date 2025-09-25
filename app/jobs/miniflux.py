import logging
from typing import Dict, Any

from ..jobs import register_handler
from .util_subpaperflux import format_site_login_pair_id, push_miniflux_cookies


def handle_miniflux_refresh(*, job_id: str, owner_user_id: str | None, payload: dict) -> Dict[str, Any]:
    # Expected payload: {"miniflux_id": str, "feed_ids": [int], "site_login_pair": str}
    miniflux_id = payload.get("miniflux_id")
    feed_ids = payload.get("feed_ids") or []
    site_login_pair = payload.get("site_login_pair")
    if not site_login_pair:
        cred = payload.get("credential_id")
        site_cfg = payload.get("site_config_id")
        if cred and site_cfg:
            site_login_pair = format_site_login_pair_id(str(cred), str(site_cfg))
    if not all([miniflux_id, feed_ids, site_login_pair]):
        raise ValueError("miniflux_id, feed_ids, and site_login_pair are required")
    logging.info(
        "[job:%s] Miniflux refresh user=%s miniflux_id=%s feeds=%s pair=%s",
        job_id,
        owner_user_id,
        miniflux_id,
        feed_ids,
        site_login_pair,
    )
    return push_miniflux_cookies(
        miniflux_id=miniflux_id,
        feed_ids=feed_ids,
        site_login_pair_id=site_login_pair,
        owner_user_id=owner_user_id,
    )


register_handler("miniflux_refresh", handle_miniflux_refresh)
