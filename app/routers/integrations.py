import requests
from fastapi import APIRouter, Depends

from ..auth.oidc import get_current_user
from ..jobs.util_subpaperflux import (
    get_instapaper_oauth_session_for_id,
    get_miniflux_config,
    resolve_config_dir,
)
from ..observability.metrics import INTEGRATION_TEST_COUNTER
from ..security.ratelimit_dep import rate_limiter_dep
# Avoid importing heavy modules at startup; use constant URL
INSTAPAPER_FOLDERS_LIST_URL = "https://www.instapaper.com/api/1.1/folders/list"


router = APIRouter(prefix="/v1/integrations", tags=["v1"])


def _resolve_config_dir_from_body(body: dict) -> str:
    explicit = body.get("config_dir") or body.get("configDir")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    return resolve_config_dir()


@router.post("/instapaper/test", response_model=dict, summary="Test Instapaper creds")
def test_instapaper(body: dict, current_user=Depends(get_current_user), _rl=Depends(rate_limiter_dep("instapaper_test"))):
    cred_id = body.get("credential_id")
    if not cred_id:
        return {"ok": False, "error": "credential_id is required"}
    config_dir = _resolve_config_dir_from_body(body)
    sess = get_instapaper_oauth_session_for_id(cred_id, current_user["sub"], config_dir=config_dir)
    if not sess:
        return {"ok": False, "error": "credential not found or no app creds"}
    try:
        # POST folders/list is low-impact and verifies auth
        resp = sess.post(INSTAPAPER_FOLDERS_LIST_URL, timeout=10)
        ok = resp.ok
        INTEGRATION_TEST_COUNTER.labels("instapaper", str(resp.status_code)).inc()
        return {"ok": ok, "status": resp.status_code}
    except requests.exceptions.HTTPError as he:  # noqa: F841
        INTEGRATION_TEST_COUNTER.labels("instapaper", str(getattr(he.response, "status_code", 500))).inc()
        return {"ok": False, "status": getattr(he.response, "status_code", 500)}
    except requests.exceptions.RequestException as e:
        INTEGRATION_TEST_COUNTER.labels("instapaper", "error").inc()
        return {"ok": False, "error": str(e)}


@router.post("/miniflux/test", response_model=dict, summary="Test Miniflux creds")
def test_miniflux(body: dict, current_user=Depends(get_current_user), _rl=Depends(rate_limiter_dep("miniflux_test"))):
    cred_id = body.get("credential_id")
    if not cred_id:
        return {"ok": False, "error": "credential_id is required"}
    cfg = get_miniflux_config(cred_id, current_user["sub"]) or {}
    url = (cfg.get("miniflux_url") or "").rstrip("/")
    api_key = cfg.get("api_key")
    if not url or not api_key:
        return {"ok": False, "error": "missing url or api_key"}
    try:
        resp = requests.get(f"{url}/v1/feeds?limit=1", headers={"X-Auth-Token": api_key}, timeout=10)
        INTEGRATION_TEST_COUNTER.labels("miniflux", str(resp.status_code)).inc()
        return {"ok": resp.ok, "status": resp.status_code}
    except requests.exceptions.HTTPError as he:  # noqa: F841
        INTEGRATION_TEST_COUNTER.labels("miniflux", str(getattr(he.response, "status_code", 500))).inc()
        return {"ok": False, "status": getattr(he.response, "status_code", 500)}
    except requests.exceptions.RequestException as e:
        INTEGRATION_TEST_COUNTER.labels("miniflux", "error").inc()
        return {"ok": False, "error": str(e)}
