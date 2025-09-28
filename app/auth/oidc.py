import logging
import os
import re
import time
from collections.abc import Iterable, Mapping, Sequence
from functools import lru_cache
from typing import Any, Dict, List, Optional, Set

import httpx
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt
from jose.utils import base64url_decode

from ..config import is_user_mgmt_oidc_only


security = HTTPBearer(auto_error=False)

logger = logging.getLogger(__name__)

USERINFO_BEARER_HEADER = "X-OIDC-Access-Token"

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


def summarize_identity(identity: Optional[Mapping[str, Any]]) -> str:
    """Return a stable, human-readable description for ``identity``."""

    if not isinstance(identity, Mapping):
        return "anonymous"

    parts: List[str] = []
    sub = identity.get("sub")
    if sub:
        parts.append(f"sub={sub}")
    user_id = identity.get("user_id")
    if user_id and user_id != sub:
        parts.append(f"user_id={user_id}")
    email = identity.get("email")
    if email:
        parts.append(f"email={email}")
    if not parts:
        claims = identity.get("claims")
        if isinstance(claims, Mapping):
            claim_sub = claims.get("sub")
            if claim_sub:
                parts.append(f"claims.sub={claim_sub}")

    return ", ".join(parts) if parts else "anonymous"


def is_oidc_identity(identity: Any) -> bool:
    """Return ``True`` when ``identity`` appears to originate from OIDC."""

    if not isinstance(identity, Mapping):
        return False
    if not identity.get("sub"):
        return False
    claims = identity.get("claims")
    if not isinstance(claims, Mapping):
        return False
    if claims.get("dev_no_auth"):
        return False
    return True


def _payload_keys_snapshot(payload: Mapping[str, Any]) -> List[str]:
    try:
        return sorted(str(key) for key in payload.keys())
    except Exception:  # noqa: BLE001
        return []


def _describe_claim_sources(values: Sequence[Any]) -> List[str]:
    descriptions: List[str] = []
    for value in values:
        if isinstance(value, Mapping):
            descriptions.append(f"{type(value).__name__}(len={len(value)})")
        elif isinstance(value, (list, tuple, set, frozenset)):
            descriptions.append(f"{type(value).__name__}(len={len(value)})")
        else:
            descriptions.append(type(value).__name__)
    return descriptions


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
    if not matches:
        logger.debug(
            "OIDC claims missing candidates %s; payload keys: %s",
            list(candidate_keys),
            _payload_keys_snapshot(payload),
        )
        return None
    for entry in matches:
        result = _extract_first_string(entry, set())
        if result:
            return result
    logger.debug(
        "OIDC claim candidates %s present but not string-coercible; value types: %s",
        list(candidate_keys),
        _describe_claim_sources(matches),
    )
    return None


def _extract_identifier_list(payload: Mapping[str, Any], candidate_keys: Sequence[str]) -> List[str]:
    targets = {_normalize_claim_key(key) for key in candidate_keys}
    matches: List[Any] = []
    _collect_matching_values(payload, targets, matches, set())
    if not matches:
        logger.debug(
            "OIDC claims missing identifier candidates %s; payload keys: %s",
            list(candidate_keys),
            _payload_keys_snapshot(payload),
        )
        return []
    results: List[str] = []
    seen: Set[str] = set()
    for entry in matches:
        values: List[str] = []
        _collect_strings(entry, values, set())
        for value in values:
            if value and value not in seen:
                seen.add(value)
                results.append(value)
    if not results:
        logger.debug(
            "OIDC identifier candidates %s present but yielded no string values; source types: %s",
            list(candidate_keys),
            _describe_claim_sources(matches),
        )
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
        self.userinfo_endpoint: Optional[str] = os.getenv("OIDC_USERINFO_ENDPOINT")
        self._userinfo_discovery_attempted: bool = False
        self._discovered_userinfo_endpoint: Optional[str] = None

    def resolve_userinfo_endpoint(self) -> Optional[str]:
        if self.userinfo_endpoint:
            return self.userinfo_endpoint
        if self._userinfo_discovery_attempted:
            return self._discovered_userinfo_endpoint

        discovery = get_oidc_discovery()
        endpoint: Optional[str] = None
        if isinstance(discovery, Mapping):
            raw_endpoint = discovery.get("userinfo_endpoint")
            if isinstance(raw_endpoint, str):
                endpoint = raw_endpoint.strip() or None

        self._userinfo_discovery_attempted = True
        self._discovered_userinfo_endpoint = endpoint
        if endpoint:
            self.userinfo_endpoint = endpoint
        return endpoint


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
    identity_summary = summarize_identity(payload)
    exp = payload.get("exp")
    if exp is None:
        logger.debug("OIDC token for %s missing 'exp' claim", identity_summary)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    try:
        exp_value = float(exp)
    except (TypeError, ValueError):
        logger.debug(
            "OIDC token for %s has invalid 'exp' claim: %r",
            identity_summary,
            exp,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    now = time.time()
    if now > exp_value:
        logger.debug(
            "OIDC token for %s expired (exp=%s, now=%s)",
            identity_summary,
            exp_value,
            now,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")


def _validate_iss_aud(payload: Dict[str, Any], cfg: OIDCConfig):
    identity_summary = summarize_identity(payload)
    iss = payload.get("iss")
    if cfg.issuer and iss != cfg.issuer:
        logger.debug(
            "OIDC issuer mismatch for %s: expected %s got %s",
            identity_summary,
            cfg.issuer,
            iss,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid issuer")
    aud = payload.get("aud")
    expected = cfg.audience or cfg.client_id
    if expected:
        if isinstance(aud, list):
            if expected not in aud:
                logger.debug(
                    "OIDC audience mismatch for %s: expected %s not in %s",
                    identity_summary,
                    expected,
                    aud,
                )
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid audience")
        else:
            if aud != expected:
                logger.debug(
                    "OIDC audience mismatch for %s: expected %s got %s",
                    identity_summary,
                    expected,
                    aud,
                )
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid audience")


def _decode_header(token: str) -> Dict[str, Any]:
    try:
        header_segment = token.split(".")[0]
        header_data = base64url_decode(header_segment.encode("utf-8"))
        return jwt.json.loads(header_data)
    except Exception:  # noqa: BLE001
        logger.debug("Failed to decode JWT header", exc_info=True)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token header")


def _verify_jwt(token: str, cfg: OIDCConfig) -> Dict[str, Any]:
    header = _decode_header(token)
    kid = header.get("kid")
    if not kid:
        header_keys = list(header.keys()) if isinstance(header, Mapping) else []
        logger.debug("JWT header missing 'kid'; header keys: %s", header_keys)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing kid in token")
    jwks = get_jwks()
    key = _find_key(jwks, kid)
    if not key:
        available = [entry.get("kid") for entry in jwks.get("keys", [])]
        logger.debug("JWKS did not contain key for kid %s; available kids: %s", kid, available)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown signing key")
    try:
        payload = jwt.decode(token, key, options={"verify_aud": False, "verify_at_hash": False})
    except Exception:  # noqa: BLE001
        logger.debug("Failed to verify JWT signature for kid %s", kid, exc_info=True)
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


def extract_userinfo_bearer(request: Request) -> Optional[str]:
    """Return the auxiliary UserInfo bearer from ``request`` if provided."""

    return request.headers.get(USERINFO_BEARER_HEADER) or None


def resolve_user_from_token(
    token: Optional[str],
    userinfo_bearer: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Return a user dictionary from a bearer token, or ``None`` if missing.

    ``userinfo_bearer`` allows callers to provide an alternate token for UserInfo requests.
    """

    if os.getenv("DEV_NO_AUTH", "0") in ("1", "true", "TRUE"):
        if is_user_mgmt_oidc_only():
            logger.debug(
                "USER_MGMT_OIDC_ONLY enabled; ignoring DEV_NO_AUTH synthetic identity",
            )
        else:
            logger.debug("DEV_NO_AUTH enabled; returning synthetic developer identity")
            return _dev_user()

    if not token:
        logger.debug("No bearer token supplied for OIDC identity resolution")
        return None

    cfg = get_oidc_config()
    jwt_payload = _verify_jwt(token, cfg)
    claims_mapping: Dict[str, Any] = dict(jwt_payload) if isinstance(jwt_payload, Mapping) else {}
    subject = claims_mapping.get("sub") if claims_mapping else None
    payload_summary = summarize_identity(claims_mapping)
    logger.debug(
        "Decoded OIDC token for %s; payload keys: %s",
        payload_summary,
        _payload_keys_snapshot(claims_mapping) if claims_mapping else [],
    )
    name = _resolve_name(claims_mapping)
    email = _resolve_email(claims_mapping)
    user_id = _resolve_user_id(claims_mapping)
    groups = _resolve_groups(claims_mapping)
    roles = _resolve_roles(claims_mapping)
    identity_summary_hint = payload_summary or (subject or "<unknown>")
    userinfo_token = userinfo_bearer or token
    userinfo_endpoint = cfg.userinfo_endpoint or None
    needs_userinfo = False
    if userinfo_token and (not name or not email or not user_id or not groups or not roles):
        if not userinfo_endpoint:
            userinfo_endpoint = cfg.resolve_userinfo_endpoint()
        needs_userinfo = bool(userinfo_endpoint)
    if needs_userinfo:
        logger.debug(
            "OIDC payload for %s missing claims; attempting UserInfo fetch from %s",
            identity_summary_hint,
            userinfo_endpoint,
        )
        if userinfo_bearer and userinfo_bearer != token:
            logger.debug(
                "Using auxiliary bearer token for UserInfo request for %s",
                identity_summary_hint,
            )
        try:
            with httpx.Client(timeout=5.0) as client:
                response = client.get(
                    userinfo_endpoint,
                    headers={"Authorization": f"Bearer {userinfo_token}"},
                )
                response.raise_for_status()
                userinfo = response.json()
        except Exception:  # noqa: BLE001
            logger.warning(
                "Failed to fetch OIDC UserInfo for %s from %s",
                identity_summary_hint,
                userinfo_endpoint,
                exc_info=True,
            )
        else:
            if isinstance(userinfo, Mapping):
                logger.debug(
                    "OIDC UserInfo enrichment for %s returned keys: %s",
                    identity_summary_hint,
                    _payload_keys_snapshot(userinfo),
                )
                claims_mapping.update(userinfo)
                new_name = _resolve_name(claims_mapping)
                if new_name:
                    name = new_name
                new_email = _resolve_email(claims_mapping)
                if new_email:
                    email = new_email
                new_user_id = _resolve_user_id(claims_mapping)
                if new_user_id:
                    user_id = new_user_id
                new_groups = _resolve_groups(claims_mapping)
                if new_groups:
                    groups = new_groups
                new_roles = _resolve_roles(claims_mapping)
                if new_roles:
                    roles = new_roles
                subject = claims_mapping.get("sub", subject)
                payload_summary = summarize_identity(claims_mapping)
                identity_summary_hint = payload_summary or (subject or "<unknown>")
            else:
                logger.warning(
                    "OIDC UserInfo response for %s was not a mapping: %s",
                    identity_summary_hint,
                    type(userinfo).__name__,
                )
    if not name:
        logger.debug(
            "OIDC payload for %s missing recognizable display name claims",
            identity_summary_hint,
        )
    if not email:
        logger.debug("OIDC payload for %s missing email claim", identity_summary_hint)
    if not user_id:
        logger.debug("OIDC payload for %s missing explicit user identifier", identity_summary_hint)
    if not groups and not roles:
        logger.debug("OIDC payload for %s missing group/role claims", identity_summary_hint)
    identity: Dict[str, Any] = {
        "sub": claims_mapping.get("sub"),
        "email": email,
        "name": name,
        "groups": groups or roles or [],
        "claims": claims_mapping,
    }
    if user_id:
        identity.setdefault("user_id", user_id)
    identity_summary = summarize_identity(identity)
    logger.debug(
        "Constructed OIDC identity for %s (has_name=%s, has_email=%s, groups=%d, roles=%d)",
        identity_summary,
        bool(name),
        bool(email),
        len(groups),
        len(roles),
    )
    if is_user_mgmt_oidc_only() and not is_oidc_identity(identity):
        logger.debug(
            "Rejecting non-OIDC identity while USER_MGMT_OIDC_ONLY is enabled (%s)",
            summarize_identity(identity),
        )
        return None

    return identity


def get_current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Dict[str, Any]:
    userinfo_bearer = extract_userinfo_bearer(request)
    user = resolve_user_from_token(
        creds.credentials if creds else None,
        userinfo_bearer=userinfo_bearer,
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    return user
