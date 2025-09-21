import os
import re
import time
from collections.abc import Iterable, Mapping, Sequence
from functools import lru_cache
from typing import Any, Dict, List, Optional, Set

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt
from jose.utils import base64url_decode


security = HTTPBearer(auto_error=False)

_NORMALIZE_PATTERN = re.compile(r"[^a-zA-Z0-9]")

_NAME_CLAIM_CANDIDATES: Sequence[str] = (
    "name",
    "display_name",
    "displayName",
    "cn",
    "common_name",
    "commonName",
)
_GIVEN_NAME_CANDIDATES: Sequence[str] = ("given_name", "givenName", "first_name", "firstName")
_FAMILY_NAME_CANDIDATES: Sequence[str] = (
    "family_name",
    "familyName",
    "last_name",
    "lastName",
    "surname",
)
_USERNAME_CANDIDATES: Sequence[str] = ("preferred_username", "nickname", "preferredName")
_EMAIL_CANDIDATES: Sequence[str] = (
    "email",
    "mail",
    "emailaddress",
    "userprincipalname",
    "upn",
    "emails",
    "primaryemail",
)
_USER_ID_CANDIDATES: Sequence[str] = ("uid", "user_id", "userid", "id", "oid", "objectid")
_GROUP_CANDIDATES: Sequence[str] = ("groups", "group")
_ROLE_CANDIDATES: Sequence[str] = ("roles", "role")


def _normalize_claim_key(key: Any) -> str:
    text = str(key)
    segments = re.split(r"[/:]", text)
    last = segments[-1] if segments else text
    return _NORMALIZE_PATTERN.sub("", last).lower()


def _collect_matching_values(
    source: Any,
    targets: Set[str],
    results: List[Any],
    visited: Set[int],
) -> None:
    if isinstance(source, Mapping):
        identity = id(source)
        if identity in visited:
            return
        visited.add(identity)
        for key, value in source.items():
            normalized = _normalize_claim_key(key)
            if normalized in targets:
                results.append(value)
            _collect_matching_values(value, targets, results, visited)
        return

    if isinstance(source, (list, tuple, set, frozenset)):
        identity = id(source)
        if identity in visited:
            return
        visited.add(identity)
        for entry in source:
            _collect_matching_values(entry, targets, results, visited)
        return

    if isinstance(source, Iterable) and not isinstance(source, (str, bytes, bytearray)):
        identity = id(source)
        if identity in visited:
            return
        visited.add(identity)
        for entry in source:
            _collect_matching_values(entry, targets, results, visited)


def _extract_first_string(value: Any, visited: Set[int]) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, (int, float, bool)):
        text = str(value).strip()
        return text or None

    if isinstance(value, Mapping):
        identity = id(value)
        if identity in visited:
            return None
        visited.add(identity)
        for entry in value.values():
            result = _extract_first_string(entry, visited)
            if result:
                return result
        return None

    if isinstance(value, (list, tuple, set, frozenset)):
        identity = id(value)
        if identity in visited:
            return None
        visited.add(identity)
        for entry in value:
            result = _extract_first_string(entry, visited)
            if result:
                return result
        return None

    if isinstance(value, Iterable) and not isinstance(value, (str, bytes, bytearray)):
        identity = id(value)
        if identity in visited:
            return None
        visited.add(identity)
        for entry in value:
            result = _extract_first_string(entry, visited)
            if result:
                return result
        return None

    return None


def _collect_strings(value: Any, results: List[str], visited: Set[int]) -> None:
    if value is None:
        return
    if isinstance(value, str):
        text = value.strip()
        if text:
            results.append(text)
        return
    if isinstance(value, (int, float, bool)):
        text = str(value).strip()
        if text:
            results.append(text)
        return

    if isinstance(value, Mapping):
        identity = id(value)
        if identity in visited:
            return
        visited.add(identity)
        for entry in value.values():
            _collect_strings(entry, results, visited)
        return

    if isinstance(value, (list, tuple, set, frozenset)):
        identity = id(value)
        if identity in visited:
            return
        visited.add(identity)
        for entry in value:
            _collect_strings(entry, results, visited)
        return

    if isinstance(value, Iterable) and not isinstance(value, (str, bytes, bytearray)):
        identity = id(value)
        if identity in visited:
            return
        visited.add(identity)
        for entry in value:
            _collect_strings(entry, results, visited)


def _extract_string_claim(payload: Mapping[str, Any], candidate_keys: Sequence[str]) -> Optional[str]:
    targets = {_normalize_claim_key(key) for key in candidate_keys}
    matches: List[Any] = []
    _collect_matching_values(payload, targets, matches, set())
    for entry in matches:
        result = _extract_first_string(entry, set())
        if result:
            return result
    return None


def _extract_identifier_list(payload: Mapping[str, Any], candidate_keys: Sequence[str]) -> List[str]:
    targets = {_normalize_claim_key(key) for key in candidate_keys}
    matches: List[Any] = []
    _collect_matching_values(payload, targets, matches, set())
    results: List[str] = []
    seen: Set[str] = set()
    for entry in matches:
        values: List[str] = []
        _collect_strings(entry, values, set())
        for value in values:
            if value and value not in seen:
                seen.add(value)
                results.append(value)
    return results


def _combine_name_parts(*parts: Optional[str]) -> Optional[str]:
    normalized = [part.strip() for part in parts if isinstance(part, str) and part.strip()]
    if not normalized:
        return None
    return " ".join(normalized)


def _resolve_name(payload: Mapping[str, Any]) -> Optional[str]:
    direct = _extract_string_claim(payload, _NAME_CLAIM_CANDIDATES)
    if direct:
        return direct
    given = _extract_string_claim(payload, _GIVEN_NAME_CANDIDATES)
    family = _extract_string_claim(payload, _FAMILY_NAME_CANDIDATES)
    combined = _combine_name_parts(given, family)
    if combined:
        return combined
    preferred = _extract_string_claim(payload, _USERNAME_CANDIDATES)
    if preferred:
        return preferred
    return None


def _resolve_email(payload: Mapping[str, Any]) -> Optional[str]:
    return _extract_string_claim(payload, _EMAIL_CANDIDATES)


def _resolve_user_id(payload: Mapping[str, Any]) -> Optional[str]:
    return _extract_string_claim(payload, _USER_ID_CANDIDATES)


def _resolve_groups(payload: Mapping[str, Any]) -> List[str]:
    return _extract_identifier_list(payload, _GROUP_CANDIDATES)


def _resolve_roles(payload: Mapping[str, Any]) -> List[str]:
    return _extract_identifier_list(payload, _ROLE_CANDIDATES)


class OIDCConfig:
    def __init__(self):
        # Accept either the issuer base (e.g., https://idp/realms/xyz)
        # or the full discovery URL (e.g., https://idp/realms/xyz/.well-known/openid-configuration)
        issuer = os.getenv("OIDC_ISSUER", "")
        if issuer.endswith("/.well-known/openid-configuration"):
            issuer = issuer[: -len("/.well-known/openid-configuration")]
        self.issuer: str = issuer
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


def _dev_user() -> Dict[str, Any]:
    dev_groups = os.getenv("DEV_USER_GROUPS", "").split(",") if os.getenv("DEV_USER_GROUPS") else []
    return {
        "sub": os.getenv("DEV_USER_SUB", "dev-user"),
        "email": os.getenv("DEV_USER_EMAIL", "dev@example.com"),
        "name": os.getenv("DEV_USER_NAME", "Developer"),
        "groups": [g.strip() for g in dev_groups if g.strip()],
        "claims": {"dev_no_auth": True},
    }


def resolve_user_from_token(token: Optional[str]) -> Optional[Dict[str, Any]]:
    """Return a user dictionary from a bearer token, or ``None`` if missing."""

    if os.getenv("DEV_NO_AUTH", "0") in ("1", "true", "TRUE"):
        return _dev_user()

    if not token:
        return None

    cfg = get_oidc_config()
    payload = _verify_jwt(token, cfg)
    claims_mapping: Mapping[str, Any] = payload if isinstance(payload, Mapping) else {}
    name = _resolve_name(claims_mapping)
    email = _resolve_email(claims_mapping)
    user_id = _resolve_user_id(claims_mapping)
    groups = _resolve_groups(claims_mapping)
    roles = _resolve_roles(claims_mapping)
    identity: Dict[str, Any] = {
        "sub": payload.get("sub"),
        "email": email,
        "name": name,
        "groups": groups or roles or [],
        "claims": payload,
    }
    if user_id:
        identity.setdefault("user_id", user_id)
    return identity


def get_current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> Dict[str, Any]:
    user = resolve_user_from_token(creds.credentials if creds else None)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    return user
