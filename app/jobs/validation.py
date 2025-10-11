from typing import Any, Dict, List, Mapping, Optional, Sequence, Union


RequiredField = Union[str, Sequence[str]]


LEGACY_SCHEDULE_PAYLOAD_KEYS = {"lookback"}


PAYLOAD_KEY_ALIASES = {
    "feedId": "feed_id",
    "feedIds": "feed_ids",
    "instapaperId": "instapaper_id",
    "instapaperCredentialId": "instapaper_credential_id",
    "minifluxId": "miniflux_id",
    "olderThan": "older_than",
    "credentialId": "credential_id",
    "siteConfigId": "site_config_id",
    "siteLoginPair": "site_login_pair",
    "siteLoginCredentialId": "site_login_credential_id",
    "siteLoginConfigId": "site_login_config_id",
}


def _normalize_payload_key(key: str) -> str:
    return PAYLOAD_KEY_ALIASES.get(key, key)


def scrub_legacy_schedule_payload(payload: Mapping[str, Any] | None) -> Dict[str, Any]:
    sanitized: Dict[str, Any] = {}
    for raw_key, value in (payload or {}).items():
        key = _normalize_payload_key(raw_key)
        if key in LEGACY_SCHEDULE_PAYLOAD_KEYS:
            continue
        # Preserve existing snake_case values when both variants are supplied.
        if key in sanitized and key != raw_key:
            continue
        sanitized[key] = value
    for legacy_key in LEGACY_SCHEDULE_PAYLOAD_KEYS:
        sanitized.pop(legacy_key, None)
    return sanitized


REQUIRED_FIELDS: Dict[str, List[RequiredField]] = {
    "login": [],
    "miniflux_refresh": ["miniflux_id", "feed_ids", "site_login_pair"],
    "rss_poll": ["feed_id"],
    "publish": ["instapaper_id"],
    "retention": ["older_than", "instapaper_credential_id"],
}


def _normalize_optional_str(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    text = str(value).strip()
    return text or None


def validate_job(job_type: str, payload: dict) -> Dict:
    sanitized_payload = scrub_legacy_schedule_payload(payload)

    missing = []
    for key in REQUIRED_FIELDS.get(job_type, []):
        if isinstance(key, (list, tuple)):
            if not any(
                (alt in sanitized_payload)
                and sanitized_payload.get(alt) not in (None, "")
                for alt in key
            ):
                missing.append(str(key[0]))
        else:
            if key not in sanitized_payload or sanitized_payload.get(key) in (None, ""):
                missing.append(key)
    if job_type == "login":
        pair_value = _normalize_optional_str(sanitized_payload.get("site_login_pair"))
        credential_id = _normalize_optional_str(sanitized_payload.get("credential_id"))
        site_config_id = _normalize_optional_str(sanitized_payload.get("site_config_id"))

        if pair_value:
            sanitized_payload["site_login_pair"] = pair_value
        else:
            sanitized_payload.pop("site_login_pair", None)

        if credential_id:
            sanitized_payload["credential_id"] = credential_id
        else:
            sanitized_payload.pop("credential_id", None)

        if site_config_id:
            sanitized_payload["site_config_id"] = site_config_id
        else:
            sanitized_payload.pop("site_config_id", None)

        if not pair_value and not (credential_id and site_config_id):
            missing.append("site_login_pair")
    if job_type == "publish":
        tags_value = sanitized_payload.get("tags")
        if tags_value is not None:
            if isinstance(tags_value, (list, tuple)):
                normalized_tags: List[str] = []
                for raw in tags_value:
                    text = str(raw).strip()
                    if not text:
                        missing.append("tags")
                        normalized_tags = []
                        break
                    normalized_tags.append(text)
                if normalized_tags:
                    sanitized_payload["tags"] = normalized_tags
            else:
                missing.append("tags")
        folder_value = sanitized_payload.get("folder_id")
        if folder_value is not None:
            text = str(folder_value).strip()
            if not text:
                missing.append("folder_id")
            else:
                sanitized_payload["folder_id"] = text

    payload.clear()
    payload.update(sanitized_payload)
    return {"ok": not missing, "missing": missing}

