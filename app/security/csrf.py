import os
from fastapi import Header, HTTPException, status


async def csrf_protect(x_csrf_token: str | None = Header(default=None)) -> None:
    """Lightweight CSRF guard for cookie-based auth deployments.

    If CSRF_ENABLED=1, require X-CSRF-Token header to be present.
    In production, integrate a real token store/validation.
    """
    if os.getenv("CSRF_ENABLED", "0") in ("1", "true", "TRUE"): 
        if not x_csrf_token:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Missing CSRF token")

