import logging

from ..jobs import register_handler
from .util_subpaperflux import push_miniflux_cookies


def handle_miniflux_refresh(*, job_id: str, owner_user_id: str | None, payload: dict) -> None:
    # Expected payload: {"config_dir": str, "miniflux_id": str, "feed_ids": [int], "cookie_key": str}
    # or {"config_dir": str, "miniflux_id": str, "feed_ids": [int], "site_config_id": str, "credential_id": str}
    config_dir = payload.get("config_dir")
    miniflux_id = payload.get("miniflux_id")
    feed_ids = payload.get("feed_ids") or []
    cookie_key = payload.get("cookie_key")
    if not cookie_key:
        scid = payload.get("site_config_id")
        cred = payload.get("credential_id")
        if scid and cred:
            cookie_key = f"{cred}-{scid}"
    if not all([config_dir, miniflux_id, feed_ids, cookie_key]):
        raise ValueError("config_dir, miniflux_id, feed_ids, and cookie_key (or site_config_id+credential_id) are required")
    logging.info("[job:%s] Miniflux refresh user=%s miniflux_id=%s feeds=%s", job_id, owner_user_id, miniflux_id, feed_ids)
    push_miniflux_cookies(config_dir, miniflux_id, feed_ids, cookie_key, owner_user_id)


register_handler("miniflux_refresh", handle_miniflux_refresh)
