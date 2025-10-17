import json
import logging
import math
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import parse_qsl

from sqlmodel import select

from ..audit import record_audit_log
from ..db import get_session_ctx
from ..integrations.instapaper import get_instapaper_oauth_session_for_credential
from ..models import (
    Bookmark as BookmarkModel,
    Cookie as CookieModel,
    Credential as CredentialModel,
    Feed as FeedModel,
    FeedTagLink as FeedTagLinkModel,
    Folder as FolderModel,
    SiteConfig as SiteConfigModel,
    SiteLoginType,
    Tag as TagModel,
)
from ..security.crypto import decrypt_dict, encrypt_dict, is_encrypted


class CookieAuthenticationError(RuntimeError):
    """Raised when stored cookies are unusable for authentication."""

    def __init__(self, message: str, *, site_login_pair_id: Optional[str] = None):
        super().__init__(message)
        self.site_login_pair_id = site_login_pair_id


class IniSection:
    """Lightweight adapter to emulate configparser.SectionProxy for get/getboolean."""

    def __init__(self, data: Optional[Dict[str, Any]] = None):
        self._data = data or {}

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def getboolean(self, key: str, fallback: bool = False) -> bool:
        val = self._data.get(key, None)
        if val is None:
            return fallback
        if isinstance(val, bool):
            return val
        if isinstance(val, (int, float)):
            return bool(val)
        s = str(val).strip().lower()
        return s in ("1", "true", "yes", "on")


_DEFAULT_API_LOGIN_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/127.0.0.0 Safari/537.36"
)


_HEADER_FIELD_NAMES: Tuple[str, ...] = (
    "article_headers",
    "content_headers",
    "http_headers",
    "header_overrides",
    "article_header_overrides",
)


def _collect_header_sources_from_site_dict(
    site_config: Optional[Dict[str, Any]]
) -> List[Any]:
    candidates: List[Any] = []
    if not isinstance(site_config, dict):
        return candidates

    for key in _HEADER_FIELD_NAMES:
        value = site_config.get(key)
        if value:
            candidates.append(value)

    for nested_key in ("selenium_config", "api_config"):
        nested = site_config.get(nested_key)
        if isinstance(nested, dict):
            for key in _HEADER_FIELD_NAMES:
                value = nested.get(key)
                if value:
                    candidates.append(value)

    return candidates


def _collect_header_sources_from_model(
    site_config: Optional[SiteConfigModel],
) -> List[Any]:
    candidates: List[Any] = []
    if site_config is None:
        return candidates

    for cfg in (site_config.selenium_config or {}, site_config.api_config or {}):
        if not isinstance(cfg, dict):
            continue
        for key in _HEADER_FIELD_NAMES:
            value = cfg.get(key)
            if value:
                candidates.append(value)

    return candidates


def _coerce_header_mapping_like(value: Any) -> Dict[str, str]:
    if not value:
        return {}

    if isinstance(value, dict):
        normalized: Dict[str, str] = {}
        for key, header_value in value.items():
            if header_value is None:
                continue
            header_name = str(key).strip()
            if not header_name:
                continue
            normalized[header_name] = str(header_value)
        return normalized

    if isinstance(value, (list, tuple)):
        normalized: Dict[str, str] = {}
        for item in value:
            if not isinstance(item, (list, tuple)) or len(item) != 2:
                continue
            header_name = str(item[0]).strip()
            header_value = item[1]
            if not header_name or header_value is None:
                continue
            normalized[header_name] = str(header_value)
        return normalized

    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        if isinstance(parsed, dict):
            return _coerce_header_mapping_like(parsed)
        return {}

    return {}


def _merge_header_overrides_local(*candidates: Any) -> Dict[str, str]:
    merged: Dict[str, str] = {}
    for candidate in candidates:
        headers = _coerce_header_mapping_like(candidate)
        if headers:
            merged.update(headers)
    return merged


def _ensure_default_api_user_agent(api_config: Optional[Dict[str, Any]]) -> None:
    if not isinstance(api_config, dict):
        return

    headers_source = api_config.get("headers")
    normalized_headers = _coerce_header_mapping_like(headers_source)

    has_user_agent = any(
        isinstance(name, str) and name.lower() == "user-agent"
        for name in normalized_headers
    )

    if not has_user_agent:
        normalized_headers["User-Agent"] = _DEFAULT_API_LOGIN_USER_AGENT

    if normalized_headers:
        api_config["headers"] = normalized_headers


def _import_spf():
    # Lazy import to avoid heavy init until needed
    import importlib

    return importlib.import_module("subpaperflux")


_API_LOGGING_PATCH_ATTR = "__subpaperflux_api_logging_patched__"
_SENSITIVE_KEYWORDS: Tuple[str, ...] = (
    "password",
    "pass",
    "token",
    "secret",
    "authorization",
    "cookie",
    "session",
    "key",
)


def _is_sensitive_key(name: Optional[str]) -> bool:
    if not name:
        return False
    lowered = str(name).strip().lower()
    return any(keyword in lowered for keyword in _SENSITIVE_KEYWORDS)


def _redact_string_payload(value: str) -> str:
    if not value:
        return value

    stripped = value.strip()
    if not stripped:
        return value

    # Try JSON payloads first
    try:
        parsed_json = json.loads(value)
    except json.JSONDecodeError:
        parsed_json = None

    if isinstance(parsed_json, (dict, list)):
        return json.dumps(_redact_sensitive_data(parsed_json))

    # Fall back to form/query payload parsing
    if "=" in value:
        try:
            parts = parse_qsl(value, keep_blank_values=True)
        except ValueError:
            parts = []
        if parts:
            redacted_parts = []
            for key, raw_val in parts:
                if _is_sensitive_key(key):
                    redacted_parts.append(f"{key}=***REDACTED***")
                else:
                    redacted_parts.append(f"{key}={raw_val}")
            return "&".join(redacted_parts)

    # Unknown format – avoid leaking long values by truncating
    if len(value) > 256:
        return value[:253] + "..."

    return value


def _redact_sensitive_data(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: Dict[str, Any] = {}
        for key, item in value.items():
            if _is_sensitive_key(key):
                redacted[key] = "***REDACTED***"
            else:
                redacted[key] = _redact_sensitive_data(item)
        return redacted
    if isinstance(value, list):
        return [_redact_sensitive_data(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_redact_sensitive_data(item) for item in value)
    if isinstance(value, str):
        return _redact_string_payload(value)
    return value


def _normalize_headers_for_logging(headers: Any) -> Dict[str, Any]:
    if isinstance(headers, dict):
        return dict(headers)
    if isinstance(headers, (list, tuple)):
        normalized: Dict[str, Any] = {}
        for item in headers:
            if isinstance(item, (list, tuple)) and len(item) == 2:
                key = item[0]
                if key is None:
                    continue
                normalized[str(key)] = item[1]
        return normalized
    return {}


def _build_api_request_preview(
    spf_module: Any,
    step_config: Dict[str, Any],
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    endpoint = (step_config or {}).get("endpoint")
    if not endpoint:
        return None

    method = (step_config.get("method") or "GET").upper()
    headers = step_config.get("headers") or {}
    body = step_config.get("body")

    render = getattr(spf_module, "_render_template", None)
    if callable(render):
        rendered_headers = render(headers, context) if headers else {}
        rendered_body = render(body, context) if body is not None else None
    else:
        rendered_headers = headers
        rendered_body = body

    normalized_headers = _normalize_headers_for_logging(rendered_headers)

    content_type = None
    for header_name, header_value in normalized_headers.items():
        if isinstance(header_name, str) and header_name.lower() == "content-type":
            if isinstance(header_value, str):
                content_type = header_value.lower()
            break

    payload_kind: Optional[str] = None
    payload_value: Any = None

    if rendered_body is not None:
        if method in ("GET", "DELETE"):
            if isinstance(rendered_body, dict):
                payload_kind = "params"
                payload_value = rendered_body
            else:
                payload_kind = "data"
                payload_value = rendered_body
        else:
            if isinstance(rendered_body, (dict, list)):
                if content_type and "application/x-www-form-urlencoded" in content_type:
                    payload_kind = "data"
                    payload_value = rendered_body
                else:
                    payload_kind = "json"
                    payload_value = rendered_body
            else:
                payload_kind = "data"
                payload_value = rendered_body

    return {
        "method": method,
        "endpoint": endpoint,
        "headers": normalized_headers,
        "payload_kind": payload_kind,
        "payload": payload_value,
    }


def _sanitize_request_preview(
    preview: Optional[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    if not preview:
        return None

    sanitized_headers = _redact_sensitive_data(preview.get("headers") or {})
    payload = preview.get("payload")
    sanitized_payload = _redact_sensitive_data(payload)

    return {
        "method": preview.get("method"),
        "endpoint": preview.get("endpoint"),
        "payload_kind": preview.get("payload_kind"),
        "headers": sanitized_headers,
        "payload": sanitized_payload,
    }


def _log_api_request_preview(
    *,
    spf_module: Any,
    step_config: Dict[str, Any],
    context: Dict[str, Any],
    config_name: str,
    step_name: str,
) -> None:
    try:
        preview = _build_api_request_preview(spf_module, step_config, context)
        sanitized = _sanitize_request_preview(preview)
        if not sanitized:
            return
        payload_kind = sanitized.get("payload_kind") or "body"
        payload = sanitized.get("payload")
        payload_repr = payload if payload is not None else "<empty>"
        logging.info(
            "API %s request details for %s: %s %s, headers=%s, %s=%s",
            step_name,
            config_name,
            sanitized.get("method"),
            sanitized.get("endpoint"),
            sanitized.get("headers"),
            payload_kind,
            payload_repr,
        )
    except Exception:
        logging.debug(
            "Failed to log API request details for %s (%s step)",
            config_name,
            step_name,
            exc_info=True,
        )


def _ensure_api_logging_patch(spf_module: Any) -> None:
    if not spf_module or getattr(spf_module, _API_LOGGING_PATCH_ATTR, False):
        return

    original_execute = getattr(spf_module, "_execute_api_step", None)
    if not callable(original_execute):
        return

    def patched_execute(session, step_config, context, config_name, step_name):
        _log_api_request_preview(
            spf_module=spf_module,
            step_config=step_config or {},
            context=context or {},
            config_name=config_name,
            step_name=step_name,
        )

        response = original_execute(
            session, step_config, context, config_name, step_name
        )

        if response is not None:
            status_code = getattr(response, "status_code", None)
            if isinstance(status_code, int) and status_code >= 400:
                try:
                    body_text = response.text
                    if isinstance(body_text, str) and len(body_text) > 512:
                        body_text = body_text[:509] + "..."
                except Exception:
                    body_text = "<unavailable>"
                logging.info(
                    "API %s response for %s returned status %s with body snippet: %s",
                    step_name,
                    config_name,
                    status_code,
                    body_text,
                )

        return response

    setattr(spf_module, "_execute_api_step", patched_execute)
    setattr(spf_module, _API_LOGGING_PATCH_ATTR, True)


def _load_json(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        return {}
    with open(path, "r") as f:
        return json.load(f)


def resolve_config_dir(explicit: Optional[str] = None) -> str:
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    for key in ("SPF_CONFIG_DIR", "SUBPAPERFLUX_CONFIG_DIR", "CONFIG_DIR"):
        value = os.getenv(key)
        if value:
            return value
    return "."


_SITE_LOGIN_PAIR_DELIMITER = "::"


def format_site_login_pair_id(credential_id: str, site_config_id: str) -> str:
    return f"{credential_id}{_SITE_LOGIN_PAIR_DELIMITER}{site_config_id}"


def parse_site_login_pair_id(pair_id: str) -> Tuple[str, str]:
    if not isinstance(pair_id, str) or _SITE_LOGIN_PAIR_DELIMITER not in pair_id:
        raise ValueError(
            "site_login_pair must be in '<credential>::<site_config>' format"
        )
    credential_id, site_config_id = pair_id.split(_SITE_LOGIN_PAIR_DELIMITER, 1)
    credential_id = credential_id.strip()
    site_config_id = site_config_id.strip()
    if not credential_id or not site_config_id:
        raise ValueError(
            "site_login_pair must include credential and site config identifiers"
        )
    return credential_id, site_config_id


def _compute_expiry_hint(cookies: List[Dict[str, Any]]) -> Optional[float]:
    expiries = []
    for c in cookies:
        exp = c.get("expiry") or c.get("expires")
        if isinstance(exp, (int, float)):
            expiries.append(float(exp))
    return min(expiries) if expiries else None


def _normalize_cookie_expiry_value(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and math.isnan(value):
            return None
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            normalized_text = text
            if text.endswith("Z"):
                normalized_text = text[:-1] + "+00:00"
            try:
                dt_value = datetime.fromisoformat(normalized_text)
            except ValueError:
                return None
            if dt_value.tzinfo is None:
                dt_value = dt_value.replace(tzinfo=timezone.utc)
            return dt_value.timestamp()
    return None


def _normalize_cookie_record(cookie: Dict[str, Any]) -> Dict[str, Any]:
    normalized: Dict[str, Any] = {}
    for key, value in cookie.items():
        if key in {"expiry", "expires"}:
            normalized_value = _normalize_cookie_expiry_value(value)
            if normalized_value is not None:
                normalized[key] = normalized_value
            elif value is not None:
                normalized[key] = value
        else:
            normalized[key] = value
    return normalized


def _filter_unexpired_cookies(
    cookies: List[Dict[str, Any]], *, now_ts: Optional[float] = None
) -> List[Dict[str, Any]]:
    if now_ts is None:
        now_ts = datetime.now(timezone.utc).timestamp()
    valid: List[Dict[str, Any]] = []
    for cookie in cookies:
        expiry = cookie.get("expiry")
        if not isinstance(expiry, (int, float)) or isinstance(expiry, bool):
            expiry = cookie.get("expires")
        if isinstance(expiry, (int, float)) and not isinstance(expiry, bool):
            exp_val = float(expiry)
            if math.isnan(exp_val) or exp_val <= now_ts:
                continue
        valid.append(cookie)
    return valid


def _enforce_cookie_values(
    cookies: Sequence[Dict[str, Any]]
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Ensure cookies include non-empty values and coerce them to strings."""

    sanitized: List[Dict[str, Any]] = []
    missing_value_names: List[str] = []

    for cookie in cookies:
        if not isinstance(cookie, dict):
            continue

        name = cookie.get("name")
        if not name:
            continue

        value = cookie.get("value")
        if value is None:
            missing_value_names.append(str(name))
            continue

        if isinstance(value, str):
            normalized_value = value
        else:
            normalized_value = str(value)

        if normalized_value == "":
            missing_value_names.append(str(name))
            continue

        normalized_cookie = dict(cookie)
        normalized_cookie["name"] = str(name)
        normalized_cookie["value"] = normalized_value
        sanitized.append(normalized_cookie)

    return sanitized, missing_value_names


def _get_db_credential(
    credential_id: str, owner_user_id: Optional[str]
) -> Optional[Dict[str, Any]]:
    if not credential_id:
        return None
    with get_session_ctx() as session:
        rec = session.get(CredentialModel, credential_id)
        if rec and (rec.owner_user_id == owner_user_id):
            try:
                return decrypt_dict(rec.data or {})
            except Exception:
                return {}
    return None


def _get_db_credential_by_kind(
    kind: str, owner_user_id: Optional[str]
) -> Optional[Dict[str, Any]]:
    with get_session_ctx() as session:
        # Prefer user-scoped record, then global (owner_user_id is NULL)
        stmt_user = select(CredentialModel).where(
            (CredentialModel.kind == kind)
            & (CredentialModel.owner_user_id == owner_user_id)
        )
        rec = session.exec(stmt_user).first()
        if rec:
            try:
                return decrypt_dict(rec.data or {})
            except Exception:
                return {}
        stmt_global = select(CredentialModel).where(
            (CredentialModel.kind == kind) & (CredentialModel.owner_user_id.is_(None))
        )
        rec2 = session.exec(stmt_global).first()
        if rec2:
            try:
                return decrypt_dict(rec2.data or {})
            except Exception:
                return {}
    return None


def _resolve_site_login_context(
    *,
    site_login_pair_id: Optional[str] = None,
    site_login_credential_id: Optional[str] = None,
    owner_user_id: Optional[str],
    config_dir: Optional[str] = None,
) -> Tuple[str, str, str, Dict[str, Any], Dict[str, Any]]:
    expected_site_config_id: Optional[str] = None
    if site_login_pair_id:
        cred_id, expected_site_config_id = parse_site_login_pair_id(site_login_pair_id)
        if site_login_credential_id and site_login_credential_id != cred_id:
            raise ValueError("Credential id does not match provided site_login_pair")
        site_login_credential_id = cred_id

    if not site_login_credential_id:
        raise ValueError("site_login_credential_id is required")

    resolved_dir = resolve_config_dir(config_dir)
    creds_file = _load_json(os.path.join(resolved_dir, "credentials.json"))
    sites_file = _load_json(os.path.join(resolved_dir, "site_configs.json"))

    credential_data: Dict[str, Any] = {}
    site_config_id: Optional[str] = None
    login_type: str = SiteLoginType.SELENIUM.value
    with get_session_ctx() as session:
        cred_record = session.get(CredentialModel, site_login_credential_id)
        if cred_record is not None:
            if cred_record.kind != "site_login":
                raise ValueError("credential must be of kind 'site_login'")
            if owner_user_id is not None and cred_record.owner_user_id != owner_user_id:
                raise ValueError(
                    "site_login credential does not belong to requesting user"
                )
            try:
                credential_data = decrypt_dict(cred_record.data or {})
            except Exception:
                credential_data = {}
            site_config_id = cred_record.site_config_id or site_config_id
        if not credential_data:
            credential_data = creds_file.get(site_login_credential_id) or {}
        if not site_config_id:
            site_config_id = (
                credential_data.get("site_config_id") or expected_site_config_id
            )
        if (
            expected_site_config_id
            and site_config_id
            and site_config_id != expected_site_config_id
        ):
            raise ValueError("site_login_pair references mismatched site config")

        site_config: Dict[str, Any] = {}
        sc_record = None
        if site_config_id:
            sc_record = session.get(SiteConfigModel, site_config_id)
        if sc_record:
            site_config = {
                "site_url": sc_record.site_url,
                "login_type": sc_record.login_type.value
                if isinstance(sc_record.login_type, SiteLoginType)
                else sc_record.login_type,
                "success_text_class": sc_record.success_text_class or "",
                "expected_success_text": sc_record.expected_success_text or "",
                "required_cookies": list(sc_record.required_cookies or []),
            }
            login_type = site_config["login_type"] or SiteLoginType.SELENIUM.value
            if site_config["login_type"] == SiteLoginType.SELENIUM.value:
                selenium_cfg = sc_record.selenium_config or {}
                site_config["selenium_config"] = {
                    "username_selector": selenium_cfg.get("username_selector")
                    or sc_record.username_selector,
                    "password_selector": selenium_cfg.get("password_selector")
                    or sc_record.password_selector,
                    "login_button_selector": selenium_cfg.get("login_button_selector")
                    or sc_record.login_button_selector,
                    "post_login_selector": selenium_cfg.get("post_login_selector")
                    or sc_record.post_login_selector,
                    "cookies_to_store": selenium_cfg.get("cookies_to_store")
                    or sc_record.cookies_to_store
                    or [],
                }
            elif site_config["login_type"] == SiteLoginType.API.value:
                api_cfg = sc_record.api_config or {}
                site_config["api_config"] = dict(api_cfg)
        elif site_config_id:
            site_config = sites_file.get(site_config_id) or {}
            if site_config.get("selenium_config") is None and site_config.get(
                "username_selector"
            ):
                site_config = {
                    "site_url": site_config.get("site_url"),
                    "login_type": site_config.get("login_type", "selenium"),
                    "selenium_config": {
                        "username_selector": site_config.get("username_selector"),
                        "password_selector": site_config.get("password_selector"),
                        "login_button_selector": site_config.get(
                            "login_button_selector"
                        ),
                        "post_login_selector": site_config.get("post_login_selector"),
                        "cookies_to_store": site_config.get("cookies_to_store", []),
                    },
                }
            site_config.setdefault("login_type", "selenium")
            site_config.setdefault("success_text_class", "")
            site_config.setdefault("expected_success_text", "")
            site_config.setdefault("required_cookies", [])
            login_type = site_config.get("login_type", "selenium")
            if login_type == "selenium":
                selenium_payload = site_config.setdefault("selenium_config", {})
                selenium_payload.setdefault("cookies_to_store", [])
            elif login_type == "api":
                api_payload = site_config.setdefault("api_config", {})
                if isinstance(api_payload, dict):
                    site_config["api_config"] = dict(api_payload)

    site_config.setdefault("success_text_class", "")
    site_config.setdefault("expected_success_text", "")
    site_config.setdefault("required_cookies", [])

    if not credential_data or not site_config or not site_config_id:
        raise ValueError("Missing login credentials or site config for provided IDs")

    login_type = (site_config.get("login_type") or login_type or "selenium").lower()

    cookies_to_store_names: List[str] = []
    if login_type == "selenium":
        selenium_payload = site_config.setdefault("selenium_config", {})
        selenium_payload.setdefault("cookies_to_store", [])
        cookies_to_store_names = list(selenium_payload.get("cookies_to_store") or [])
    elif login_type == "api":
        api_payload = site_config.setdefault("api_config", {})
        if isinstance(api_payload, dict):
            normalized_api_payload = dict(api_payload)
            _ensure_default_api_user_agent(normalized_api_payload)
            site_config["api_config"] = normalized_api_payload
            cookies_to_store_names = list(
                normalized_api_payload.get("cookies_to_store") or []
            )
            if not cookies_to_store_names:
                cookie_map = normalized_api_payload.get("cookies") or {}
                if cookie_map:
                    cookies_to_store_names = list(cookie_map.keys())

    required_cookie_names = list(site_config.get("required_cookies") or [])
    if not required_cookie_names:
        required_cookie_names = list(cookies_to_store_names)
    site_config["required_cookies"] = required_cookie_names

    return (
        site_login_credential_id,
        site_config_id,
        login_type,
        credential_data,
        site_config,
    )


def _merge_publication_structures(
    *,
    existing_statuses: Optional[Dict[str, Any]],
    existing_flags: Optional[Dict[str, Any]],
    instapaper_id: Optional[str],
    seen_at: str,
    is_paywalled: bool,
    raw_html_content: Optional[str],
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    statuses = dict(existing_statuses or {})
    instapaper_status = dict(statuses.get("instapaper") or {})
    instapaper_status.setdefault("status", "pending")
    instapaper_status["updated_at"] = seen_at
    statuses["instapaper"] = instapaper_status

    flags = dict(existing_flags or {})
    instapaper_flags = dict(flags.get("instapaper") or {})
    instapaper_flags.setdefault(
        "created_at", instapaper_flags.get("last_seen_at") or seen_at
    )
    instapaper_flags.update(
        {
            "should_publish": True,
            "is_paywalled": bool(is_paywalled),
            "last_seen_at": seen_at,
            "has_raw_html": bool(raw_html_content)
            or instapaper_flags.get("has_raw_html", False),
        }
    )
    if instapaper_id:
        instapaper_flags["credential_id"] = instapaper_id
    flags["instapaper"] = instapaper_flags

    return statuses, flags


def perform_login_and_save_cookies(
    *,
    site_login_pair_id: str,
    owner_user_id: Optional[str],
) -> Dict[str, Any]:
    spf = _import_spf()
    _ensure_api_logging_patch(spf)

    (
        credential_id,
        site_config_id,
        login_type,
        login_credentials,
        site_config,
    ) = _resolve_site_login_context(
        site_login_pair_id=site_login_pair_id,
        owner_user_id=owner_user_id,
    )

    logging.info(
        "Dispatching %s login for site_config=%s", login_type, site_config_id
    )

    login_result = spf.login_and_update(
        site_config_id, site_config, login_credentials
    )

    if not isinstance(login_result, dict):
        raise RuntimeError("Login handler returned unexpected payload")

    resolved_login_type = login_result.get("login_type", login_type)
    cookies_payload = login_result.get("cookies") or []
    if not cookies_payload:
        error_message = login_result.get("error") or "Login did not return any cookies"
        raise RuntimeError(
            f"{resolved_login_type} login failed for site_config={site_config_id}: {error_message}"
        )

    cookies_to_store_names: List[str] = []
    if resolved_login_type == "selenium":
        cookies_to_store_names = list(
            (site_config.get("selenium_config") or {}).get("cookies_to_store") or []
        )
    elif resolved_login_type == "api":
        api_payload = site_config.get("api_config") or {}
        cookies_to_store_names = list(api_payload.get("cookies_to_store") or [])
        if not cookies_to_store_names:
            cookie_map = api_payload.get("cookies") or {}
            if cookie_map:
                cookies_to_store_names = list(cookie_map.keys())

    cookies = cookies_payload
    if cookies_to_store_names:
        cookies = [
            cookie
            for cookie in cookies_payload
            if cookie.get("name") in cookies_to_store_names
        ]

    cookies, missing_value_names = _enforce_cookie_values(cookies)
    missing_value_name_set = set(missing_value_names)
    if missing_value_name_set:
        logging.warning(
            "Dropping cookies with missing values for site_config=%s: %s",
            site_config_id,
            ", ".join(sorted(missing_value_name_set)),
        )

    if cookies_to_store_names:
        available_cookie_names = {cookie["name"] for cookie in cookies}
        missing_for_storage = [
            name
            for name in cookies_to_store_names
            if name and name not in available_cookie_names
        ]
        missing_storage_due_to_value = [
            name for name in missing_for_storage if name in missing_value_name_set
        ]
        if missing_storage_due_to_value:
            raise RuntimeError(
                "{} login failed for site_config={}: missing cookie values for: {}".format(
                    resolved_login_type,
                    site_config_id,
                    ", ".join(sorted(set(missing_storage_due_to_value))),
                )
            )
        if missing_for_storage:
            raise RuntimeError(
                "{} login failed for site_config={}: missing cookies required for storage: {}".format(
                    resolved_login_type,
                    site_config_id,
                    ", ".join(missing_for_storage),
                )
            )

    required_cookie_names = list(site_config.get("required_cookies") or [])
    if not required_cookie_names and cookies_to_store_names:
        required_cookie_names = list(cookies_to_store_names)

    if cookies_to_store_names:
        required_names_for_storage = [
            name for name in required_cookie_names if name in cookies_to_store_names
        ]
    else:
        required_names_for_storage = list(required_cookie_names)

    if required_names_for_storage:
        missing_required_due_to_value = [
            name for name in required_names_for_storage if name in missing_value_name_set
        ]
        if missing_required_due_to_value:
            raise RuntimeError(
                "{} login failed for site_config={}: missing cookie values for: {}".format(
                    resolved_login_type,
                    site_config_id,
                    ", ".join(sorted(set(missing_required_due_to_value))),
                )
            )
        available_cookie_names = {cookie["name"] for cookie in cookies}
        missing_required = [
            name
            for name in required_names_for_storage
            if name and name not in available_cookie_names
        ]
        if missing_required:
            raise RuntimeError(
                "{} login failed for site_config={}: missing required cookies: {}".format(
                    resolved_login_type,
                    site_config_id,
                    ", ".join(missing_required),
                )
            )

    if not cookies:
        error_message = login_result.get("error") or "Login did not return any cookies"
        raise RuntimeError(
            f"{resolved_login_type} login failed for site_config={site_config_id}: {error_message}"
        )

    # Backward-compat: previously wrote to cookie_state.json. Now store in DB.
    pair_id = format_site_login_pair_id(credential_id, site_config_id)
    encrypted_payload = encrypt_dict({"cookies": cookies})
    encrypted_blob = json.dumps(encrypted_payload)
    expiry_hint = _compute_expiry_hint(cookies)
    now_iso = datetime.now(timezone.utc).isoformat()
    with get_session_ctx() as session:
        stmt = select(CookieModel).where(
            (CookieModel.credential_id == credential_id)
            & (CookieModel.site_config_id == site_config_id)
        )
        existing = session.exec(stmt).first()
        if existing:
            existing.encrypted_cookies = encrypted_blob
            existing.last_refresh = now_iso
            existing.expiry_hint = expiry_hint
            if owner_user_id is not None:
                existing.owner_user_id = owner_user_id
            session.add(existing)
        else:
            new = CookieModel(
                credential_id=credential_id,
                site_config_id=site_config_id,
                owner_user_id=owner_user_id,
                encrypted_cookies=encrypted_blob,
                last_refresh=now_iso,
                expiry_hint=expiry_hint,
            )
            session.add(new)
        session.commit()
    logging.info("Saved cookies to DB for pair=%s", pair_id)
    logging.info(
        "Saved %s cookies for site_config=%s via %s login",
        len(cookies),
        site_config_id,
        resolved_login_type,
    )
    return {
        "site_login_pair": pair_id,
        "cookies_saved": len(cookies),
        "login_type": resolved_login_type,
    }


def _decode_cookie_blob(blob: Optional[Any]) -> List[Dict[str, Any]]:
    payload = blob
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            payload = None
    if isinstance(payload, dict) and is_encrypted(payload):
        try:
            payload = decrypt_dict(payload)
        except Exception:
            payload = None
    if isinstance(payload, dict):
        cookies = payload.get("cookies")
        if isinstance(cookies, list):
            normalized: List[Dict[str, Any]] = []
            for cookie in cookies:
                if not isinstance(cookie, dict):
                    continue
                normalized.append(_normalize_cookie_record(cookie))
            return normalized
    return []


def _get_cookies_for_pair(
    credential_id: str, site_config_id: str
) -> List[Dict[str, Any]]:
    if not credential_id or not site_config_id:
        return []
    with get_session_ctx() as session:
        stmt = select(CookieModel).where(
            (CookieModel.credential_id == credential_id)
            & (CookieModel.site_config_id == site_config_id)
        )
        rec = session.exec(stmt).first()
        if not rec:
            return []
        return _decode_cookie_blob(rec.encrypted_cookies)


def get_cookies_for_site_login_pair(
    site_login_pair_id: str, owner_user_id: Optional[str]
) -> List[Dict[str, Any]]:
    if not site_login_pair_id:
        return []
    credential_id, site_config_id = parse_site_login_pair_id(site_login_pair_id)
    required_cookie_names: List[str] = []
    cookies_to_store_names: List[str] = []
    with get_session_ctx() as session:
        cred = session.get(CredentialModel, credential_id)
        if not cred or cred.kind != "site_login":
            return []
        if owner_user_id is not None and cred.owner_user_id != owner_user_id:
            return []
        if cred.site_config_id and cred.site_config_id != site_config_id:
            raise ValueError("site_login_pair references mismatched site config")
        sc_record = session.get(SiteConfigModel, site_config_id)
        if sc_record:
            selenium_cfg = sc_record.selenium_config or {}
            selenium_cookies = []
            if isinstance(selenium_cfg, dict):
                selenium_cookies = list(selenium_cfg.get("cookies_to_store") or [])

            api_cfg = sc_record.api_config or {}
            api_cookies: List[str] = []
            if isinstance(api_cfg, dict):
                api_cookies = list(api_cfg.get("cookies_to_store") or [])
                if not api_cookies:
                    cookie_map = api_cfg.get("cookies") or {}
                    if isinstance(cookie_map, dict):
                        api_cookies = list(cookie_map.keys())

            combined_cookies: List[str] = []
            for name in selenium_cookies + api_cookies:
                if name and name not in combined_cookies:
                    combined_cookies.append(name)

            cookies_to_store_names = combined_cookies
            required_cookie_names = list(sc_record.required_cookies or [])
            if not required_cookie_names:
                required_cookie_names = list(cookies_to_store_names)
    cookies = _get_cookies_for_pair(credential_id, site_config_id)
    if not cookies:
        return []
    filtered = _filter_unexpired_cookies(cookies)
    if cookies and not filtered:
        raise CookieAuthenticationError(
            "Stored cookies are expired and cannot be used for authentication",
            site_login_pair_id=site_login_pair_id,
        )
    sanitized, missing_value_names = _enforce_cookie_values(filtered)
    missing_value_name_set = set(missing_value_names)
    if missing_value_name_set:
        logging.warning(
            "Stored cookies for pair=%s have missing values for: %s",
            site_login_pair_id,
            ", ".join(sorted(missing_value_name_set)),
        )

    available_names = {cookie["name"] for cookie in sanitized}

    if cookies_to_store_names:
        missing_storage_due_to_value = [
            name for name in cookies_to_store_names if name in missing_value_name_set
        ]
        if missing_storage_due_to_value:
            raise CookieAuthenticationError(
                "Stored cookies are missing values for configured cookies: {}".format(
                    ", ".join(sorted(set(missing_storage_due_to_value)))
                ),
                site_login_pair_id=site_login_pair_id,
            )
        missing_storage = [
            name
            for name in cookies_to_store_names
            if name and name not in available_names
        ]
        if missing_storage:
            raise CookieAuthenticationError(
                "Stored cookies are missing configured cookies: {}".format(
                    ", ".join(missing_storage)
                ),
                site_login_pair_id=site_login_pair_id,
            )

    if cookies_to_store_names:
        required_names_for_storage = [
            name for name in required_cookie_names if name in cookies_to_store_names
        ]
    else:
        required_names_for_storage = list(required_cookie_names)

    if required_names_for_storage:
        missing_required = [
            name
            for name in required_names_for_storage
            if name and name not in available_names
        ]
        if missing_required:
            missing_due_to_value = [
                name for name in missing_required if name in missing_value_name_set
            ]
            other_missing = sorted(
                set(missing_required) - set(missing_due_to_value)
            )
            reasons: List[str] = []
            if missing_due_to_value:
                reasons.append(
                    "missing values for: {}".format(
                        ", ".join(sorted(set(missing_due_to_value)))
                    )
                )
            if other_missing:
                reasons.append(
                    "missing cookies: {}".format(", ".join(other_missing))
                )
            message = "Stored cookies are missing required authentication cookies"
            if reasons:
                message = f"{message} ({'; '.join(reasons)})"
            raise CookieAuthenticationError(
                message,
                site_login_pair_id=site_login_pair_id,
            )

    return sanitized


def invalidate_cookies_for_site_login_pair(
    site_login_pair_id: str, owner_user_id: Optional[str] = None
) -> bool:
    """Delete stored cookies for the provided site login pair."""

    if not site_login_pair_id:
        return False

    credential_id, site_config_id = parse_site_login_pair_id(site_login_pair_id)

    with get_session_ctx() as session:
        stmt = select(CookieModel).where(
            (CookieModel.credential_id == credential_id)
            & (CookieModel.site_config_id == site_config_id)
        )
        if owner_user_id is not None:
            stmt = stmt.where(CookieModel.owner_user_id == owner_user_id)
        record = session.exec(stmt).first()
        if not record:
            return False

        session.delete(record)
        session.commit()

    logging.info("Invalidated cookies for site_login_pair=%s", site_login_pair_id)
    return True


def parse_lookback_to_seconds(s: str) -> int:
    import re

    v = int(re.findall(r"\d+", s)[0])
    u = re.findall(r"[a-z]", s)[0].lower()
    return (
        v if u == "s" else v * 60 if u == "m" else v * 3600 if u == "h" else v * 86400
    )


def poll_rss_and_publish(
    *,
    instapaper_id: Optional[str] = None,
    feed_id: str,
    lookback: Optional[str] = None,
    is_paywalled: Optional[bool] = None,
    rss_requires_auth: Optional[bool] = None,
    site_login_pair_id: Optional[str] = None,
    owner_user_id: Optional[str] = None,
) -> Dict[str, int]:
    spf = _import_spf()
    from datetime import datetime, timezone, timedelta

    resolved_dir = resolve_config_dir()
    instapaper_cfg: Dict[str, Any] = {}
    app_creds: Dict[str, Any] = {}
    if instapaper_id:
        app_creds_file = (
            _load_json(os.path.join(resolved_dir, "instapaper_app_creds.json")) or {}
        )
        credentials_file = _load_json(os.path.join(resolved_dir, "credentials.json"))
        instapaper_cfg_file = {}
        if isinstance(credentials_file, dict):
            instapaper_cfg_file = credentials_file.get(instapaper_id) or {}
        instapaper_cfg = (
            _get_db_credential(instapaper_id, owner_user_id) or instapaper_cfg_file
        )
        app_creds = (
            _get_db_credential_by_kind("instapaper_app", owner_user_id)
            or app_creds_file
        )

    feed_site_header_sources: List[Any] = []
    with get_session_ctx() as session:
        feed = session.get(FeedModel, feed_id)
        if not feed:
            raise ValueError("Feed not found for provided feed_id")
        if owner_user_id is not None and feed.owner_user_id != owner_user_id:
            raise ValueError("Feed does not belong to requesting user")
        feed_url = feed.url
        feed_poll_frequency = feed.poll_frequency or "1h"
        feed_lookback = feed.initial_lookback_period or "24h"
        feed_is_paywalled = feed.is_paywalled
        feed_requires_auth = feed.rss_requires_auth
        feed_site_config_id = feed.site_config_id
        feed_site_login_credential_id = feed.site_login_credential_id
        feed_last_poll_at = feed.last_rss_poll_at
        feed_site_config = None
        if feed_site_config_id:
            sc = session.get(SiteConfigModel, feed_site_config_id)
            if sc:
                feed_site_config = {
                    "sanitizing_criteria": sc.cookies_to_store or [],
                }
                feed_site_header_sources = _collect_header_sources_from_model(sc)

    if not site_login_pair_id and feed_site_login_credential_id and feed_site_config_id:
        site_login_pair_id = format_site_login_pair_id(
            str(feed_site_login_credential_id), str(feed_site_config_id)
        )

    effective_lookback = lookback or feed_lookback or "24h"
    effective_is_paywalled = feed_is_paywalled if is_paywalled is None else is_paywalled
    effective_requires_auth = (
        feed_requires_auth if rss_requires_auth is None else rss_requires_auth
    )

    # Build INI-like sections
    instapaper_ini = IniSection(
        {
            "folder": "",
            "resolve_final_url": True,
            "sanitize_content": True,
            "add_default_tag": True,
            "add_categories_as_tags": True,
        }
    )
    rss_ini = IniSection(
        {
            "feed_url": feed_url,
            "poll_frequency": feed_poll_frequency,
            "initial_lookback_period": effective_lookback,
            "is_paywalled": effective_is_paywalled,
            "rss_requires_auth": effective_requires_auth,
        }
    )

    # State with last_rss_timestamp set by lookback on first poll only
    now = datetime.now(timezone.utc)
    cutoff = None
    if feed_last_poll_at:
        cutoff = feed_last_poll_at
        if cutoff.tzinfo is None:
            cutoff = cutoff.replace(tzinfo=timezone.utc)
    if cutoff is None:
        cutoff = now - timedelta(seconds=parse_lookback_to_seconds(effective_lookback))
    state = {
        "last_rss_timestamp": cutoff,
        "last_rss_poll_time": cutoff,
        "last_miniflux_refresh_time": cutoff,
        "force_run": False,
        "force_sync_and_purge": False,
        "bookmarks": {},
    }

    # Site config (for sanitization hints)
    site_cfg = None
    site_header_sources: List[Any] = []
    cookies: List[Dict[str, Any]] = []
    if site_login_pair_id:
        _, resolved_site_config_id, resolved_login_type, _, resolved_site_config = (
            _resolve_site_login_context(
                site_login_pair_id=site_login_pair_id,
                owner_user_id=owner_user_id,
                config_dir=resolved_dir,
            )
        )
        cookies_to_store = []
        if resolved_login_type == "selenium":
            cookies_to_store = (resolved_site_config.get("selenium_config") or {}).get(
                "cookies_to_store"
            ) or []
        site_cfg = {
            "sanitizing_criteria": cookies_to_store,
        }
        site_header_sources = _collect_header_sources_from_site_dict(
            resolved_site_config
        )
        cookies = get_cookies_for_site_login_pair(site_login_pair_id, owner_user_id)
    elif feed_site_config:
        site_cfg = feed_site_config
        cookies = []
        site_header_sources = list(feed_site_header_sources)

    header_candidates: List[Any] = list(site_header_sources)
    if rss_ini:
        for key in _HEADER_FIELD_NAMES:
            value = rss_ini.get(key)
            if value:
                header_candidates.append(value)
        extract_prefixed = getattr(spf, "_extract_prefixed_headers", None)
        if callable(extract_prefixed):
            prefixed = extract_prefixed(rss_ini)
            if prefixed:
                header_candidates.append(prefixed)

    merge_headers = getattr(spf, "merge_header_overrides", None)
    if not callable(merge_headers):
        merge_headers = _merge_header_overrides_local

    header_overrides = merge_headers(*header_candidates)

    cookie_invalidator = None
    if site_login_pair_id:
        def _invalidate_cookies(exc: Exception) -> None:
            reason = getattr(exc, "indicator", None)
            logging.info(
                "Invalidating cookies for pair=%s after paywall detection%s",
                site_login_pair_id,
                f" (indicator={reason})" if reason else "",
            )
            invalidate_cookies_for_site_login_pair(
                site_login_pair_id, owner_user_id
            )

        cookie_invalidator = _invalidate_cookies

    new_entries = spf.get_new_rss_entries(
        config_file=os.path.join(resolved_dir, "adhoc.ini"),
        feed_url=feed_url,
        instapaper_config=instapaper_cfg,
        app_creds=app_creds,
        rss_feed_config=rss_ini,
        instapaper_ini_config=instapaper_ini,
        cookies=cookies,
        state=state,
        site_config=site_cfg,
        header_overrides=header_overrides,
        cookie_invalidator=cookie_invalidator,
    )

    stored = 0
    duplicates = 0
    total_entries = len(new_entries)

    poll_completed_at = datetime.now(timezone.utc)

    with get_session_ctx() as session:
        for entry in new_entries:
            url = entry.get("url")
            if not url:
                continue

            seen_at = datetime.now(timezone.utc).isoformat()

            published_at_value = entry.get("published_dt")
            if isinstance(published_at_value, str):
                try:
                    published_at_value = datetime.fromisoformat(published_at_value)
                except Exception:
                    published_at_value = None

            rss_entry_metadata = entry.get("rss_entry_metadata") or {}
            feed_meta = rss_entry_metadata.get("feed") or {}
            if feed_id:
                feed_meta.setdefault("id", feed_id)
            feed_meta.setdefault("url", feed_url)
            rss_entry_metadata["feed"] = feed_meta
            rss_entry_metadata["ingested_at"] = seen_at
            rss_entry_metadata["is_paywalled"] = bool(effective_is_paywalled)

            raw_html_content = entry.get("raw_html_content")

            stmt = (
                select(BookmarkModel)
                .where(
                    (BookmarkModel.owner_user_id == owner_user_id)
                    & (BookmarkModel.url == url)
                    & (
                        (BookmarkModel.feed_id == feed_id)
                        | (BookmarkModel.feed_id.is_(None))
                    )
                )
                .order_by(BookmarkModel.published_at.desc(), BookmarkModel.id.desc())
            )
            existing = session.exec(stmt).first()

            if existing:
                duplicates += 1
                changed = False

                merged_metadata = dict(existing.rss_entry or {})
                merged_metadata.update(rss_entry_metadata)
                if merged_metadata != existing.rss_entry:
                    existing.rss_entry = merged_metadata
                    changed = True

                if raw_html_content and raw_html_content != (
                    existing.raw_html_content or ""
                ):
                    existing.raw_html_content = raw_html_content
                    changed = True

                publication_statuses, publication_flags = _merge_publication_structures(
                    existing_statuses=existing.publication_statuses,
                    existing_flags=existing.publication_flags,
                    instapaper_id=instapaper_id,
                    seen_at=seen_at,
                    is_paywalled=effective_is_paywalled,
                    raw_html_content=raw_html_content,
                )

                if publication_statuses != existing.publication_statuses:
                    existing.publication_statuses = publication_statuses
                    changed = True

                if publication_flags != existing.publication_flags:
                    existing.publication_flags = publication_flags
                    changed = True

                if changed:
                    session.add(existing)
                    session.commit()
                continue

            publication_statuses, publication_flags = _merge_publication_structures(
                existing_statuses=None,
                existing_flags=None,
                instapaper_id=instapaper_id,
                seen_at=seen_at,
                is_paywalled=effective_is_paywalled,
                raw_html_content=raw_html_content,
            )

            bm = BookmarkModel(
                owner_user_id=owner_user_id,
                instapaper_bookmark_id=None,
                url=url,
                title=entry.get("title"),
                content_location=None,
                feed_id=feed_id,
                published_at=published_at_value,
                rss_entry=rss_entry_metadata,
                raw_html_content=raw_html_content,
                publication_statuses=publication_statuses,
                publication_flags=publication_flags,
            )
            session.add(bm)
            record_audit_log(
                session,
                entity_type="bookmark",
                entity_id=bm.id,
                action="create",
                owner_user_id=bm.owner_user_id,
                actor_user_id=owner_user_id,
                details={
                    "source": "rss_ingest",
                    "feed_id": feed_id,
                    "publication_statuses": publication_statuses,
                    "publication_flags": publication_flags,
                },
            )
            session.commit()
            stored += 1

        feed_record = session.get(FeedModel, feed_id)
        if feed_record:
            feed_record.last_rss_poll_at = poll_completed_at
            session.add(feed_record)
            session.commit()

    return {"stored": stored, "duplicates": duplicates, "total": total_entries}


def get_instapaper_oauth_session(owner_user_id: Optional[str]):
    from sqlmodel import select
    from requests_oauthlib import OAuth1Session

    with get_session_ctx() as session:
        stmt = select(CredentialModel).where(
            (CredentialModel.owner_user_id == owner_user_id)
            & (CredentialModel.kind == "instapaper")
        )
        rec = session.exec(stmt).first()
        app_stmt_user = select(CredentialModel).where(
            (CredentialModel.owner_user_id == owner_user_id)
            & (CredentialModel.kind == "instapaper_app")
        )
        app_stmt_global = select(CredentialModel).where(
            (CredentialModel.owner_user_id.is_(None))
            & (CredentialModel.kind == "instapaper_app")
        )
        app = (
            session.exec(app_stmt_user).first() or session.exec(app_stmt_global).first()
        )
    if not rec or not app:
        return None
    user_data = decrypt_dict(rec.data or {})
    app_data = decrypt_dict(app.data or {})
    return OAuth1Session(
        app_data.get("consumer_key"),
        client_secret=app_data.get("consumer_secret"),
        resource_owner_key=user_data.get("oauth_token"),
        resource_owner_secret=user_data.get("oauth_token_secret"),
    )


def get_instapaper_oauth_session_for_id(
    instapaper_cred_id: str,
    owner_user_id: Optional[str],
    config_dir: Optional[str] = None,
):
    """Create OAuth1Session for a specific instapaper credential id (user-scoped)."""
    from requests_oauthlib import OAuth1Session

    with get_session_ctx() as session:
        rec = session.get(CredentialModel, instapaper_cred_id)
        app_stmt_user = select(CredentialModel).where(
            (CredentialModel.owner_user_id == owner_user_id)
            & (CredentialModel.kind == "instapaper_app")
        )
        app_stmt_global = select(CredentialModel).where(
            (CredentialModel.owner_user_id.is_(None))
            & (CredentialModel.kind == "instapaper_app")
        )
        app = (
            session.exec(app_stmt_user).first() or session.exec(app_stmt_global).first()
        )
    if not rec or rec.owner_user_id != owner_user_id:
        return None
    user_data = decrypt_dict(rec.data or {})
    app_data: Dict[str, Any] = {}
    if app:
        try:
            app_data = decrypt_dict(app.data or {}) or {}
        except Exception:
            app_data = {}
    if not app_data:
        resolved_dir = resolve_config_dir(config_dir)
        app_data = (
            _load_json(os.path.join(resolved_dir, "instapaper_app_creds.json")) or {}
        )
    if not app_data:
        return None
    return OAuth1Session(
        app_data.get("consumer_key"),
        client_secret=app_data.get("consumer_secret"),
        resource_owner_key=user_data.get("oauth_token"),
        resource_owner_secret=user_data.get("oauth_token_secret"),
    )


def get_miniflux_config(
    miniflux_cred_id: str, owner_user_id: Optional[str]
) -> Optional[Dict[str, Any]]:
    with get_session_ctx() as session:
        rec = session.get(CredentialModel, miniflux_cred_id)
    if not rec or rec.owner_user_id != owner_user_id or rec.kind != "miniflux":
        return None
    return decrypt_dict(rec.data or {})


def get_ordered_feed_tag_ids(session, feed_id: Optional[str]) -> List[str]:
    if not feed_id:
        return []
    stmt = (
        select(FeedTagLinkModel)
        .where(FeedTagLinkModel.feed_id == feed_id)
        .order_by(FeedTagLinkModel.position.asc())
    )
    rows = session.exec(stmt).all()
    ordered: List[str] = []
    for row in rows:
        tag_id = getattr(row, "tag_id", None)
        if not tag_id:
            continue
        ordered.append(str(tag_id))
    return ordered


def translate_tag_ids_to_names(
    session,
    owner_user_id: Optional[str],
    tag_ids: Sequence[str],
    *,
    cache: Optional[Dict[str, Optional[str]]] = None,
) -> List[str]:
    cache = cache if cache is not None else {}
    seen: set[str] = set()
    ordered: List[str] = []
    for raw in tag_ids:
        text = str(raw).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        ordered.append(text)
    missing = [tag_id for tag_id in ordered if tag_id not in cache]
    if missing:
        stmt = select(TagModel).where(TagModel.id.in_(missing))
        if owner_user_id is None:
            stmt = stmt.where(TagModel.owner_user_id.is_(None))
        else:
            stmt = stmt.where(TagModel.owner_user_id == owner_user_id)
        rows = session.exec(stmt).all()
        for tag in rows:
            cache[tag.id] = tag.name
        for tag_id in missing:
            cache.setdefault(tag_id, None)
    names: List[str] = []
    for tag_id in ordered:
        name = cache.get(tag_id)
        if name:
            names.append(name)
    return names


def resolve_effective_folder(
    session,
    *,
    feed: Optional[FeedModel],
    schedule_folder_id: Optional[str],
    cache: Optional[Dict[str, Optional[FolderModel]]] = None,
) -> Optional[FolderModel]:
    folder_id: Optional[str] = None
    if schedule_folder_id not in (None, ""):
        folder_id = str(schedule_folder_id).strip()
    elif feed and feed.folder_id not in (None, ""):
        folder_id = str(feed.folder_id)
    if not folder_id:
        return None
    if cache is not None and folder_id in cache:
        return cache[folder_id]
    folder = session.get(FolderModel, folder_id)
    if cache is not None:
        cache[folder_id] = folder
    return folder


def sync_instapaper_folders(
    session,
    *,
    instapaper_credential_id: str,
    owner_user_id: Optional[str],
    config_dir: Optional[str] = None,
    timeout: int = 10,
) -> Dict[str, Optional[str]]:
    oauth = get_instapaper_oauth_session_for_credential(
        instapaper_credential_id,
        owner_user_id,
        config_dir=config_dir,
    )
    if not oauth:
        return {}

    resp = oauth.post(INSTAPAPER_FOLDERS_LIST_URL, timeout=timeout)
    resp.raise_for_status()
    try:
        remote_entries = resp.json()
    except ValueError:
        remote_entries = json.loads(resp.text or "[]")

    remote_by_id: Dict[str, dict] = {}
    remote_by_title: Dict[str, str] = {}
    for entry in remote_entries or []:
        remote_id = entry.get("folder_id")
        if remote_id is None:
            continue
        remote_id_str = str(remote_id)
        remote_by_id[remote_id_str] = entry
        title = entry.get("title")
        if isinstance(title, str) and title:
            remote_by_title.setdefault(title, remote_id_str)

    stmt = select(FolderModel)
    if owner_user_id is None:
        stmt = stmt.where(FolderModel.owner_user_id.is_(None))
    else:
        stmt = stmt.where(FolderModel.owner_user_id == owner_user_id)
    local_folders = session.exec(stmt).all()

    mapping: Dict[str, Optional[str]] = {}
    used_remote_ids: set[str] = set()

    for folder in local_folders:
        current_remote = folder.instapaper_folder_id
        if current_remote and current_remote not in remote_by_id:
            folder.instapaper_folder_id = None
            session.add(folder)
        elif current_remote:
            used_remote_ids.add(current_remote)

    for folder in local_folders:
        if folder.instapaper_folder_id:
            mapping[folder.id] = folder.instapaper_folder_id
            continue
        match_id = remote_by_title.get(folder.name)
        if match_id and match_id not in used_remote_ids:
            folder.instapaper_folder_id = match_id
            used_remote_ids.add(match_id)
            session.add(folder)
            mapping[folder.id] = match_id
            continue
        if not folder.name:
            mapping[folder.id] = None
            continue
        resp_add = oauth.post(
            INSTAPAPER_FOLDERS_ADD_URL,
            data={"title": folder.name},
            timeout=timeout,
        )
        resp_add.raise_for_status()
        try:
            created_entries = resp_add.json()
        except ValueError:
            created_entries = json.loads(resp_add.text or "[]")
        created_id: Optional[str] = None
        if isinstance(created_entries, list) and created_entries:
            created_id = created_entries[0].get("folder_id")
        if created_id is not None:
            created_id = str(created_id)
            folder.instapaper_folder_id = created_id
            used_remote_ids.add(created_id)
        mapping[folder.id] = folder.instapaper_folder_id
        session.add(folder)

    for folder in local_folders:
        mapping.setdefault(folder.id, folder.instapaper_folder_id)

    return mapping


def push_miniflux_cookies(
    *,
    miniflux_id: str,
    feed_ids: List[int],
    site_login_pair_id: str,
    owner_user_id: Optional[str],
) -> Dict[str, Any]:
    spf = _import_spf()
    resolved_dir = resolve_config_dir()
    creds = _load_json(os.path.join(resolved_dir, "credentials.json"))
    miniflux_cfg = (
        _get_db_credential(miniflux_id, owner_user_id) or creds.get(miniflux_id) or {}
    )

    credential_id, site_config_id, _, _, _ = _resolve_site_login_context(
        site_login_pair_id=site_login_pair_id,
        owner_user_id=owner_user_id,
        config_dir=resolved_dir,
    )
    cookies = get_cookies_for_site_login_pair(site_login_pair_id, owner_user_id)
    if not cookies:
        raise RuntimeError("No cookies found for provided site login credential")

    pair_id = format_site_login_pair_id(credential_id, site_config_id)
    ids_str = ",".join(str(i) for i in feed_ids)
    from ..util.ratelimit import limiter as _limiter

    _limiter.wait("miniflux")
    spf.update_miniflux_feed_with_cookies(
        miniflux_cfg, cookies, config_name=pair_id, feed_ids_str=ids_str
    )
    return {
        "feed_ids": feed_ids,
        "site_login_pair": pair_id,
        "site_config_id": site_config_id,
    }


def publish_url(
    instapaper_id: str,
    url: str,
    title: Optional[str] = None,
    folder: Optional[str] = None,
    folder_id: Optional[str] = None,
    tags: Optional[List[str]] = None,
    owner_user_id: Optional[str] = None,
    config_dir: Optional[str] = None,
    raw_html_content: Optional[str] = None,
) -> Dict[str, Any]:
    spf = _import_spf()
    resolved_dir = resolve_config_dir(config_dir)
    creds = _load_json(os.path.join(resolved_dir, "credentials.json"))
    app_creds_file = _load_json(os.path.join(resolved_dir, "instapaper_app_creds.json"))
    # Fetch user-scoped Instapaper tokens and (optionally) app creds from DB
    instapaper_cfg = (
        _get_db_credential(instapaper_id, owner_user_id)
        or creds.get(instapaper_id)
        or {}
    )
    app_creds = (
        _get_db_credential_by_kind("instapaper_app", owner_user_id) or app_creds_file
    )

    instapaper_ini_config = IniSection(
        {
            "folder": folder,
            "folder_id": folder_id,
            "tags": ",".join(tags) if tags else "",
            "resolve_final_url": True,
            "sanitize_content": True,
            "add_default_tag": True,
            "add_categories_as_tags": False,
        }
    )

    from ..util.ratelimit import limiter

    limiter.wait("instapaper")
    # Idempotency check for direct publish
    try:
        window_sec = int(os.getenv("PUBLISH_DEDUPE_WINDOW_SEC", "86400"))
    except Exception:
        window_sec = 86400
    if owner_user_id and window_sec > 0:
        from datetime import datetime, timezone, timedelta

        since = datetime.now(timezone.utc) - timedelta(seconds=window_sec)
        with get_session_ctx() as session:
            from sqlmodel import select

            stmt = select(BookmarkModel).where(
                (BookmarkModel.owner_user_id == owner_user_id)
                & (BookmarkModel.url == url)
                & (
                    (BookmarkModel.published_at.is_(None))
                    | (BookmarkModel.published_at >= since)
                )
            )
            exists = session.exec(stmt).first()
            if exists:
                return {
                    "bookmark_id": exists.instapaper_bookmark_id,
                    "title": title,
                    "content_location": None,
                    "deduped": True,
                }

    result = spf.publish_to_instapaper(
        instapaper_cfg,
        app_creds,
        url,
        title,
        raw_html_content=raw_html_content,
        categories_from_feed=[],
        instapaper_ini_config=instapaper_ini_config,
        site_config=None,
        resolve_final_url=True,
    )
    if not result:
        raise RuntimeError("Instapaper publish failed")
    result["deduped"] = False
    return result


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        if cleaned.endswith("Z"):
            cleaned = cleaned[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(cleaned)
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    return None


def _publication_sort_key(bookmark: BookmarkModel) -> Tuple[str, str, str, str]:
    flags = (bookmark.publication_flags or {}).get("instapaper") or {}
    rss_entry = bookmark.rss_entry or {}
    created = str(flags.get("created_at") or flags.get("last_seen_at") or "")
    ingested = str(rss_entry.get("ingested_at") or "")
    published = bookmark.published_at.isoformat() if bookmark.published_at else ""
    return (created, ingested, published, bookmark.id or "")


def iter_pending_instapaper_bookmarks(
    session,
    *,
    owner_user_id: Optional[str],
    instapaper_id: str,
    feed_id: Optional[str],
    limit: Optional[int] = None,
    include_paywalled: Optional[bool] = None,
) -> List[BookmarkModel]:
    stmt = select(BookmarkModel).where(BookmarkModel.owner_user_id == owner_user_id)
    if feed_id is not None:
        stmt = stmt.where(BookmarkModel.feed_id == feed_id)
    rows = session.exec(stmt).all()
    pending: List[BookmarkModel] = []
    for bookmark in rows:
        flags = (bookmark.publication_flags or {}).get("instapaper") or {}
        if not flags.get("should_publish"):
            continue
        credential_id = flags.get("credential_id")
        if credential_id and str(credential_id) != str(instapaper_id):
            continue
        if (
            include_paywalled is not None
            and bool(flags.get("is_paywalled")) != include_paywalled
        ):
            continue
        statuses = (bookmark.publication_statuses or {}).get("instapaper") or {}
        status_value = str(statuses.get("status") or "pending").lower()
        if status_value == "published":
            continue
        pending.append(bookmark)
    pending.sort(key=_publication_sort_key)
    if limit is not None:
        try:
            parsed_limit = int(limit)
        except (TypeError, ValueError):
            parsed_limit = None
        if parsed_limit is not None and parsed_limit >= 0:
            pending = pending[:parsed_limit]
    return pending


def apply_publication_result(
    bookmark: BookmarkModel,
    *,
    instapaper_id: str,
    job_id: str,
    result: Optional[Dict[str, Any]] = None,
    error: Optional[BaseException] = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    statuses = dict(bookmark.publication_statuses or {})
    instapaper_status = dict(statuses.get("instapaper") or {})
    instapaper_status["credential_id"] = instapaper_id
    instapaper_status["updated_at"] = now_iso

    flags = dict(bookmark.publication_flags or {})
    instapaper_flags = dict(flags.get("instapaper") or {})
    instapaper_flags.setdefault("should_publish", True)
    instapaper_flags.setdefault(
        "created_at", instapaper_flags.get("last_seen_at") or now_iso
    )
    instapaper_flags.setdefault("credential_id", instapaper_id)

    if result is not None:
        instapaper_status["status"] = "published"
        instapaper_status["deduped"] = bool(result.get("deduped"))
        bookmark_id = result.get("bookmark_id") or instapaper_status.get("bookmark_id")
        if bookmark_id:
            instapaper_status["bookmark_id"] = str(bookmark_id)
            bookmark.instapaper_bookmark_id = str(bookmark_id)
        content_location = result.get("content_location") or instapaper_status.get(
            "content_location"
        )
        if content_location:
            instapaper_status["content_location"] = content_location
            bookmark.content_location = content_location
        published_dt = _parse_iso_datetime(result.get("published_at")) or now
        instapaper_status["published_at"] = published_dt.isoformat()
        bookmark.published_at = published_dt
        instapaper_flags["last_published_at"] = published_dt.isoformat()
        instapaper_flags["last_publish_job_id"] = job_id
        instapaper_flags.pop("last_error_at", None)
        instapaper_flags.pop("last_error_message", None)
    else:
        message = str(error) if error else "Unknown publication error"
        instapaper_status["status"] = "error"
        instapaper_status["error_message"] = message
        instapaper_flags["last_error_at"] = now_iso
        instapaper_flags["last_error_message"] = message

    statuses["instapaper"] = instapaper_status
    flags["instapaper"] = instapaper_flags
    bookmark.publication_statuses = statuses
    bookmark.publication_flags = flags

    return instapaper_status, instapaper_flags
INSTAPAPER_FOLDERS_LIST_URL = "https://www.instapaper.com/api/1.1/folders/list"
INSTAPAPER_FOLDERS_ADD_URL = "https://www.instapaper.com/api/1.1/folders/add"

