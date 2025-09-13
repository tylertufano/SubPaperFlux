from typing import Optional

import requests
from fastapi import APIRouter, Depends

from ..auth.oidc import get_current_user
from ..jobs.util_subpaperflux import (
    get_instapaper_oauth_session_for_id,
    get_miniflux_config,
)
# Avoid importing heavy modules at startup
INSTAPAPER_FOLDERS_LIST_URL = "https://www.instapaper.com/api/1.1/folders/list"


router = APIRouter(prefix="/v1/integrations", tags=["v1"])


@router.post("/instapaper/test", response_model=dict, summary="Test Instapaper creds")
def test_instapaper(body: dict, current_user=Depends(get_current_user)):
    cred_id = body.get("credential_id")
    if not cred_id:
        return {"ok": False, "error": "credential_id is required"}
    sess = get_instapaper_oauth_session_for_id(cred_id, current_user["sub"])
    if not sess:
        return {"ok": False, "error": "credential not found or no app creds"}
    try:
        # POST folders/list is low-impact and verifies auth
        resp = sess.post(INSTAPAPER_FOLDERS_LIST_URL, timeout=10)
        ok = resp.ok
        return {"ok": ok, "status": resp.status_code}
    except requests.exceptions.HTTPError as he:  # noqa: F841
        return {"ok": False, "status": getattr(he.response, "status_code", 500)}
    except requests.exceptions.RequestException as e:
        return {"ok": False, "error": str(e)}


@router.post("/miniflux/test", response_model=dict, summary="Test Miniflux creds")
def test_miniflux(body: dict, current_user=Depends(get_current_user)):
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
        return {"ok": resp.ok, "status": resp.status_code}
    except requests.exceptions.HTTPError as he:  # noqa: F841
        return {"ok": False, "status": getattr(he.response, "status_code", 500)}
    except requests.exceptions.RequestException as e:
        return {"ok": False, "error": str(e)}

