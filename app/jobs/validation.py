from typing import Dict, List, Sequence, Union


RequiredField = Union[str, Sequence[str]]


REQUIRED_FIELDS: Dict[str, List[RequiredField]] = {
    "login": ["site_login_pair"],
    "miniflux_refresh": ["miniflux_id", "feed_ids", "site_login_pair"],
    "rss_poll": ["feed_id"],
    "publish": ["instapaper_id"],
    "retention": ["older_than", "instapaper_credential_id"],
}


def validate_job(job_type: str, payload: dict) -> Dict:
    missing = []
    for key in REQUIRED_FIELDS.get(job_type, []):
        if isinstance(key, (list, tuple)):
            if not any(
                (alt in payload) and payload.get(alt) not in (None, "")
                for alt in key
            ):
                missing.append(str(key[0]))
        else:
            if key not in payload or payload.get(key) in (None, ""):
                missing.append(key)
    if job_type == "publish":
        tags_value = payload.get("tags")
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
                    payload["tags"] = normalized_tags
            else:
                missing.append("tags")
        folder_value = payload.get("folder_id")
        if folder_value is not None:
            text = str(folder_value).strip()
            if not text:
                missing.append("folder_id")
            else:
                payload["folder_id"] = text
    return {"ok": not missing, "missing": missing}

