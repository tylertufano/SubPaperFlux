import logging
from typing import Dict, Any

from ..jobs import register_handler
from .util_subpaperflux import perform_login_and_save_cookies


def handle_login(*, job_id: str, owner_user_id: str | None, payload: dict) -> Dict[str, Any]:
    # Expected payload: {"config_dir": str, "site_login_credential_id": str}
    config_dir = payload.get("config_dir")
    site_login_credential_id = payload.get("site_login_credential_id") or payload.get("credential_id")
    if not all([config_dir, site_login_credential_id]):
        raise ValueError("config_dir and site_login_credential_id are required")
    logging.info(
        "[job:%s] Login requested user=%s credential=%s",
        job_id,
        owner_user_id,
        site_login_credential_id,
    )
    return perform_login_and_save_cookies(
        config_dir=config_dir,
        site_login_credential_id=site_login_credential_id,
        owner_user_id=owner_user_id,
    )


register_handler("login", handle_login)
