import os
import time
from typing import Dict


class RateLimiter:
    def __init__(self, default_interval: float = 0.2):
        self.default_interval = default_interval
        self._last: Dict[str, float] = {}
        self._overrides: Dict[str, float] = {}

    def set_interval(self, key: str, interval: float) -> None:
        self._overrides[key] = interval

    def wait(self, key: str) -> None:
        interval = self._overrides.get(key, self.default_interval)
        now = time.time()
        last = self._last.get(key, 0)
        delta = now - last
        if delta < interval:
            time.sleep(interval - delta)
        self._last[key] = time.time()


limiter = RateLimiter(default_interval=float(os.getenv("RL_DEFAULT_INTERVAL", "0.2")))
if (v := os.getenv("RL_INSTAPAPER_INTERVAL")):
    limiter.set_interval("instapaper", float(v))
if (v := os.getenv("RL_MINIFLUX_INTERVAL")):
    limiter.set_interval("miniflux", float(v))

