"""Instapaper integration helpers."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import parse_qsl

import requests
from oauthlib.oauth1 import Client as OAuth1Client
from requests_oauthlib import OAuth1Session
from sqlmodel import select

from ..db import get_session_ctx
from ..models import Credential
from ..security.crypto import decrypt_dict


logger = logging.getLogger(__name__)

INSTAPAPER_OAUTH_TOKEN_URL = "https://www.instapaper.com/api/1/oauth/access_token"
INSTAPAPER_BOOKMARKS_DELETE_URL = "https://www.instapaper.com/api/1.1/bookmarks/delete"


@dataclass
class InstapaperTokenResponse:
    """Result of an Instapaper xAuth token exchange."""

    success: bool
    oauth_token: Optional[str] = None
    oauth_token_secret: Optional[str] = None
    error: Optional[str] = None
    status_code: Optional[int] = None

    def tokens(self) -> Optional[Dict[str, str]]:
        if not self.success:
            return None
        if not self.oauth_token or not self.oauth_token_secret:
            return None
        return {
            "oauth_token": self.oauth_token,
            "oauth_token_secret": self.oauth_token_secret,
        }


def resolve_config_dir(explicit: Optional[str] = None) -> str:
    """Resolve the configuration directory used for integration fallbacks."""

    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    for key in ("SPF_CONFIG_DIR", "SUBPAPERFLUX_CONFIG_DIR", "CONFIG_DIR"):
        value = os.getenv(key)
        if value:
            return value
    return "."


def _load_instapaper_app_creds_from_file(config_dir: Optional[str] = None) -> Dict[str, Any]:
    path = Path(resolve_config_dir(config_dir)) / "instapaper_app_creds.json"
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as fp:
            return json.load(fp)
    except (OSError, json.JSONDecodeError):
        logger.exception("Failed to load instapaper_app_creds.json from %s", path)
        return {}


def _get_instapaper_app_creds(
    owner_user_id: Optional[str], config_dir: Optional[str] = None
) -> Dict[str, Any]:
    with get_session_ctx() as session:
        stmt_user = select(Credential).where(
            (Credential.owner_user_id == owner_user_id)
            & (Credential.kind == "instapaper_app")
        )
        stmt_global = select(Credential).where(
            (Credential.owner_user_id.is_(None))
            & (Credential.kind == "instapaper_app")
        )
        record = session.exec(stmt_user).first() or session.exec(stmt_global).first()

    app_creds: Dict[str, Any] = {}
    if record:
        try:
            app_creds = decrypt_dict(record.data or {}) or {}
        except Exception:  # pragma: no cover - defensive
            logger.exception("Failed to decrypt Instapaper app credentials for %s", record.id)
            app_creds = {}

    if not app_creds:
        app_creds = _load_instapaper_app_creds_from_file(config_dir)

    return app_creds


def get_instapaper_oauth_session_for_credential(
    credential_id: str,
    owner_user_id: Optional[str],
    *,
    config_dir: Optional[str] = None,
) -> Optional[OAuth1Session]:
    """Create an OAuth session for a stored Instapaper credential."""

    if not credential_id:
        return None

    with get_session_ctx() as session:
        record = session.get(Credential, credential_id)

    if (
        record is None
        or record.kind != "instapaper"
        or record.owner_user_id != owner_user_id
    ):
        return None

    try:
        user_data = decrypt_dict(record.data or {}) or {}
    except Exception:  # pragma: no cover - defensive
        logger.exception("Failed to decrypt Instapaper credential %s", credential_id)
        return None

    app_creds = _get_instapaper_app_creds(owner_user_id, config_dir=config_dir)

    consumer_key = app_creds.get("consumer_key")
    consumer_secret = app_creds.get("consumer_secret")
    token = user_data.get("oauth_token")
    token_secret = user_data.get("oauth_token_secret")

    if not all([consumer_key, consumer_secret, token, token_secret]):
        return None

    return OAuth1Session(
        consumer_key,
        client_secret=consumer_secret,
        resource_owner_key=token,
        resource_owner_secret=token_secret,
    )


def get_instapaper_tokens(
    consumer_key: str,
    consumer_secret: str,
    username: str,
    password: str,
    *,
    timeout: int = 30,
) -> InstapaperTokenResponse:
    """Exchange Instapaper credentials for OAuth tokens using xAuth."""

    if not consumer_key or not consumer_secret:
        logger.error("Instapaper consumer key/secret are required for token exchange")
        return InstapaperTokenResponse(
            success=False,
            error="missing_consumer_keys",
        )

    oauth_client = OAuth1Client(
        consumer_key,
        client_secret=consumer_secret,
        signature_method="HMAC-SHA1",
    )
    body_params = {
        "x_auth_username": username,
        "x_auth_password": password,
        "x_auth_mode": "client_auth",
    }
    try:
        uri, headers, _ = oauth_client.sign(
            uri=INSTAPAPER_OAUTH_TOKEN_URL,
            http_method="POST",
            body=body_params,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    except Exception:
        logger.exception("Failed to sign Instapaper token request")
        return InstapaperTokenResponse(success=False, error="signing_error")

    try:
        response = requests.post(uri, headers=headers, data=body_params, timeout=timeout)
    except requests.exceptions.RequestException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        logger.warning("Instapaper token request failed: %s", exc)
        return InstapaperTokenResponse(
            success=False,
            error=str(exc),
            status_code=status,
        )

    if response.status_code >= 400:
        error_text = response.text.strip() or f"HTTP {response.status_code}"
        logger.info(
            "Instapaper token request rejected: status=%s body=%s",
            response.status_code,
            error_text,
        )
        return InstapaperTokenResponse(
            success=False,
            error=error_text,
            status_code=response.status_code,
        )

    try:
        parsed = dict(parse_qsl(response.text))
    except Exception:
        logger.exception("Failed to parse Instapaper token response")
        return InstapaperTokenResponse(
            success=False,
            error="parse_error",
            status_code=response.status_code,
        )

    token = parsed.get("oauth_token")
    token_secret = parsed.get("oauth_token_secret")
    if not token or not token_secret:
        logger.error(
            "Instapaper token response missing required fields: %s", parsed
        )
        return InstapaperTokenResponse(
            success=False,
            error="missing_token_fields",
            status_code=response.status_code,
        )

    return InstapaperTokenResponse(
        success=True,
        oauth_token=token,
        oauth_token_secret=token_secret,
        status_code=response.status_code,
    )
