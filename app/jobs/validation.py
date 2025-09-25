from typing import Dict, List


REQUIRED_FIELDS: Dict[str, List[str]] = {
    "login": ["config_dir", "site_login_pair"],
    "miniflux_refresh": ["config_dir", "miniflux_id", "feed_ids", "site_login_pair"],
    "rss_poll": ["config_dir", "instapaper_id", "feed_id"],
    "publish": ["config_dir", "instapaper_id", "url"],
    "retention": ["older_than", "instapaper_id"],
}


def validate_job(job_type: str, payload: dict) -> Dict:
    missing = []
    for key in REQUIRED_FIELDS.get(job_type, []):
        if key not in payload or payload.get(key) in (None, ""):
            missing.append(key)
    return {"ok": not missing, "missing": missing}

