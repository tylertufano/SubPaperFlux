import logging
from typing import Dict, Any

from ..jobs import register_handler
from .util_subpaperflux import push_miniflux_cookies


def handle_miniflux_refresh(*, job_id: str, owner_user_id: str | None, payload: dict) -> Dict[str, Any]:
    # Expected payload: {"config_dir": str, "miniflux_id": str, "feed_ids": [int], "site_login_pair": str}
    config_dir = payload.get("config_dir")
    miniflux_id = payload.get("miniflux_id")
    feed_ids = payload.get("feed_ids") or []
    site_login_pair = payload.get("site_login_pair")
    if not all([config_dir, miniflux_id, feed_ids, site_login_pair]):
        raise ValueError("config_dir, miniflux_id, feed_ids, and site_login_pair are required")
    logging.info(
        "[job:%s] Miniflux refresh user=%s miniflux_id=%s feeds=%s pair=%s",
        job_id,
        owner_user_id,
        miniflux_id,
        feed_ids,
        site_login_pair,
    )
    return push_miniflux_cookies(
        config_dir=config_dir,
        miniflux_id=miniflux_id,
        feed_ids=feed_ids,
        site_login_pair_id=site_login_pair,
        owner_user_id=owner_user_id,
    )


register_handler("miniflux_refresh", handle_miniflux_refresh)
