import logging
from typing import Dict, Any

from ..jobs import register_handler
from .util_subpaperflux import perform_login_and_save_cookies


def handle_login(*, job_id: str, owner_user_id: str | None, payload: dict) -> Dict[str, Any]:
    # Expected payload: {"config_dir": str, "site_login_pair": "<cred>::<site>"}
    config_dir = payload.get("config_dir")
    site_login_pair = payload.get("site_login_pair")
    if not all([config_dir, site_login_pair]):
        raise ValueError("config_dir and site_login_pair are required")
    logging.info(
        "[job:%s] Login requested user=%s pair=%s",
        job_id,
        owner_user_id,
        site_login_pair,
    )
    return perform_login_and_save_cookies(
        config_dir=config_dir,
        site_login_pair_id=site_login_pair,
        owner_user_id=owner_user_id,
    )


register_handler("login", handle_login)
