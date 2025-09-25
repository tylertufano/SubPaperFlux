import logging
from typing import Dict, Any

from ..jobs import register_handler
from .util_subpaperflux import format_site_login_pair_id, perform_login_and_save_cookies


def handle_login(*, job_id: str, owner_user_id: str | None, payload: dict) -> Dict[str, Any]:
    # Expected payload: {"site_login_pair": "<cred>::<site>"}
    site_login_pair = payload.get("site_login_pair")
    if not site_login_pair:
        cred = payload.get("credential_id")
        site_cfg = payload.get("site_config_id")
        if cred and site_cfg:
            site_login_pair = format_site_login_pair_id(str(cred), str(site_cfg))
    if not site_login_pair:
        raise ValueError("site_login_pair is required")
    logging.info(
        "[job:%s] Login requested user=%s pair=%s",
        job_id,
        owner_user_id,
        site_login_pair,
    )
    return perform_login_and_save_cookies(
        site_login_pair_id=site_login_pair,
        owner_user_id=owner_user_id,
    )


register_handler("login", handle_login)
