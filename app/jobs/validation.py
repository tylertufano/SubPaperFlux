from typing import Dict, List, Sequence, Union


RequiredField = Union[str, Sequence[str]]


REQUIRED_FIELDS: Dict[str, List[RequiredField]] = {
    "login": ["site_login_pair"],
    "miniflux_refresh": ["miniflux_id", "feed_ids", "site_login_pair"],
    "rss_poll": ["feed_id"],
    "publish": ["instapaper_id", "url"],
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
    return {"ok": not missing, "missing": missing}

