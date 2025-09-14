from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from ..auth.oidc import get_current_user
from ..auth.rbac import is_admin
from ..db import get_session, is_postgres
from ..db_admin import prepare_postgres_search, enable_rls


router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/postgres/prepare", response_model=dict)
def postgres_prepare(current_user=Depends(get_current_user), session=Depends(get_session)):
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not is_postgres():
        raise HTTPException(status_code=400, detail="Not using Postgres backend")
    details = prepare_postgres_search(session)
    return {"ok": bool(details.get("ok", True)), "details": details}


@router.post("/postgres/enable-rls", response_model=dict)
def postgres_enable_rls(current_user=Depends(get_current_user), session=Depends(get_session)):
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not is_postgres():
        raise HTTPException(status_code=400, detail="Not using Postgres backend")
    details = enable_rls(session)
    return {"ok": bool(details.get("ok", True)), "details": details}
