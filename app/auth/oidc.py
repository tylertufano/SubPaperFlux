import os
import time
from functools import lru_cache
from typing import Any, Dict, Optional

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt
from jose.utils import base64url_decode


security = HTTPBearer(auto_error=True)


class OIDCConfig:
    def __init__(self):
        self.issuer: str = os.getenv("OIDC_ISSUER", "")
        self.audience: Optional[str] = os.getenv("OIDC_AUDIENCE")
        self.client_id: Optional[str] = os.getenv("OIDC_CLIENT_ID")
        # If not provided, will be discovered via issuer
        self.jwks_url: Optional[str] = os.getenv("OIDC_JWKS_URL")


@lru_cache(maxsize=1)
def get_oidc_config() -> OIDCConfig:
    return OIDCConfig()


@lru_cache(maxsize=1)
def get_oidc_discovery() -> Dict[str, Any]:
    cfg = get_oidc_config()
    if not cfg.issuer:
        return {}
    url = cfg.issuer.rstrip("/") + "/.well-known/openid-configuration"
    with httpx.Client(timeout=5.0) as client:
        r = client.get(url)
        r.raise_for_status()
        return r.json()


@lru_cache(maxsize=1)
def get_jwks() -> Dict[str, Any]:
    cfg = get_oidc_config()
    jwks_url = cfg.jwks_url
    if not jwks_url:
        discovery = get_oidc_discovery()
        jwks_url = discovery.get("jwks_uri")
    if not jwks_url:
        raise RuntimeError("OIDC_JWKS_URL or issuer discovery jwks_uri is required")
    with httpx.Client(timeout=5.0) as client:
        r = client.get(jwks_url)
        r.raise_for_status()
        return r.json()


def oidc_startup_event() -> None:
    # Best-effort prefetch to warm caches; failures will be retried lazily.
    try:
        _ = get_jwks()
    except Exception:
        pass


def _find_key(jwks: Dict[str, Any], kid: str) -> Optional[Dict[str, Any]]:
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return key
    return None


def _validate_exp(payload: Dict[str, Any]):
    exp = payload.get("exp")
    if exp is None or time.time() > float(exp):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")


def _validate_iss_aud(payload: Dict[str, Any], cfg: OIDCConfig):
    iss = payload.get("iss")
    if cfg.issuer and iss != cfg.issuer:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid issuer")
    aud = payload.get("aud")
    expected = cfg.audience or cfg.client_id
    if expected:
        if isinstance(aud, list):
            if expected not in aud:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid audience")
        else:
            if aud != expected:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid audience")


def _decode_header(token: str) -> Dict[str, Any]:
    try:
        header_segment = token.split(".")[0]
        header_data = base64url_decode(header_segment.encode("utf-8"))
        return jwt.json.loads(header_data)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token header")


def _verify_jwt(token: str, cfg: OIDCConfig) -> Dict[str, Any]:
    header = _decode_header(token)
    kid = header.get("kid")
    if not kid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing kid in token")
    jwks = get_jwks()
    key = _find_key(jwks, kid)
    if not key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown signing key")
    try:
        payload = jwt.decode(token, key, options={"verify_aud": False, "verify_at_hash": False})
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token signature")
    _validate_exp(payload)
    _validate_iss_aud(payload, cfg)
    return payload


def get_current_user(creds: HTTPAuthorizationCredentials = Depends(security)) -> Dict[str, Any]:
    # Dev/test bypass: enable with DEV_NO_AUTH=1 (NOT for production)
    if os.getenv("DEV_NO_AUTH", "0") in ("1", "true", "TRUE"):
        dev_groups = os.getenv("DEV_USER_GROUPS", "").split(",") if os.getenv("DEV_USER_GROUPS") else []
        return {
            "sub": os.getenv("DEV_USER_SUB", "dev-user"),
            "email": os.getenv("DEV_USER_EMAIL", "dev@example.com"),
            "name": os.getenv("DEV_USER_NAME", "Developer"),
            "groups": [g.strip() for g in dev_groups if g.strip()],
            "claims": {"dev_no_auth": True},
        }

    token = creds.credentials
    cfg = get_oidc_config()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    payload = _verify_jwt(token, cfg)
    # Map minimal fields; extend as needed
    return {
        "sub": payload.get("sub"),
        "email": payload.get("email"),
        "name": payload.get("name"),
        "groups": payload.get("groups") or payload.get("roles") or [],
        "claims": payload,
    }
