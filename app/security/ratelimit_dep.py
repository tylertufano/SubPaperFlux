import os
import time
from typing import Dict, Tuple

from fastapi import Depends, HTTPException, status

from ..auth.oidc import get_current_user


_WINDOWS: Dict[Tuple[str, str], Tuple[int, float]] = {}


def rate_limiter_dep(namespace: str):
    """Simple in-memory per-user rate-limiter dependency.

    namespace: a short name for the route group (e.g., 'instapaper_test').
    Env vars:
      TEST_RATE_LIMIT_COUNT (default 5)
      TEST_RATE_LIMIT_WINDOW_SEC (default 10)
    """

    limit = int(os.getenv("TEST_RATE_LIMIT_COUNT", "5"))
    window = float(os.getenv("TEST_RATE_LIMIT_WINDOW_SEC", "10"))

    async def _limiter(user=Depends(get_current_user)):
        user_id = user.get("sub") or "anonymous"
        key = (namespace, str(user_id))
        now = time.time()
        count, start = _WINDOWS.get(key, (0, now))
        # Reset window
        if now - start >= window:
            count, start = 0, now
        count += 1
        _WINDOWS[key] = (count, start)
        if count > limit:
            retry_after = int(max(0, window - (now - start)))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded for this test endpoint",
                headers={"Retry-After": str(retry_after)},
            )

    return _limiter

