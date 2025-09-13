from fastapi import APIRouter, Depends
from sqlalchemy import text

from ..db import get_session, is_postgres
from .integrations import test_instapaper, test_miniflux

from ..schemas import StatusResponse


router = APIRouter(tags=["status"])


@router.get("/status", response_model=StatusResponse)
def get_status():
    return StatusResponse()


@router.get("/status/db", response_model=dict)
def db_status(session=Depends(get_session)):
    ok = True
    details = {"backend": "postgres" if is_postgres() else "other"}
    if is_postgres():
        try:
            # Check pg_trgm extension
            has_trgm = session.exec(text("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm')")).scalar()
            details["pg_trgm_enabled"] = bool(has_trgm)
            # Check indexes exist
            idx_names = [
                "ix_bookmark_title_trgm",
                "ix_bookmark_url_trgm",
                "ix_bookmark_published_at",
            ]
            found = {}
            for name in idx_names:
                q = text("""
                    SELECT EXISTS (
                        SELECT 1 FROM pg_indexes WHERE indexname = :name
                    )
                """)
                exists = session.exec(q.params(name=name)).scalar()
                found[name] = bool(exists)
            details["indexes"] = found
            ok = bool(has_trgm) and all(found.values())
        except Exception as e:  # noqa: BLE001
            ok = False
            details["error"] = str(e)
    return {"ok": ok, "details": details}


@router.get("/status/integrations", response_model=dict)
def integrations_status(instapaper_cred_id: str | None = None, miniflux_cred_id: str | None = None, current_user=Depends(get_current_user)):
    details = {}
    if instapaper_cred_id:
        details["instapaper"] = test_instapaper({"credential_id": instapaper_cred_id}, current_user)
    else:
        details["instapaper"] = {"endpoint": "/v1/integrations/instapaper/test"}
    if miniflux_cred_id:
        details["miniflux"] = test_miniflux({"credential_id": miniflux_cred_id}, current_user)
    else:
        details["miniflux"] = {"endpoint": "/v1/integrations/miniflux/test"}
    return {"ok": True, "details": details}
