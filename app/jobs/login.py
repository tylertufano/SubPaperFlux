import logging

from ..jobs import register_handler
from .util_subpaperflux import perform_login_and_save_cookies


def handle_login(*, job_id: str, owner_user_id: str | None, payload: dict) -> None:
    # Expected payload: {"config_dir": str, "site_config_id": str, "credential_id": str}
    config_dir = payload.get("config_dir")
    site_config_id = payload.get("site_config_id")
    credential_id = payload.get("credential_id")
    if not all([config_dir, site_config_id, credential_id]):
        raise ValueError("config_dir, site_config_id, and credential_id are required")
    logging.info("[job:%s] Login requested user=%s site_config=%s cred=%s", job_id, owner_user_id, site_config_id, credential_id)
    perform_login_and_save_cookies(config_dir, site_config_id, credential_id, owner_user_id)


register_handler("login", handle_login)
