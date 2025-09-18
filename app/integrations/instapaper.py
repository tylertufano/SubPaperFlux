"""Instapaper integration helpers."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, Optional
from urllib.parse import parse_qsl

import requests
from oauthlib.oauth1 import Client as OAuth1Client


logger = logging.getLogger(__name__)

INSTAPAPER_OAUTH_TOKEN_URL = "https://www.instapaper.com/api/1/oauth/access_token"


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
