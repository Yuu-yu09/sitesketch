"""
Rate limiting.

Small, dependency-free, in-process limiter. It exists to make guessing a
password expensive and to stop one client hammering an endpoint; it is not
a substitute for a real WAF (see SECURITY.md for that).

Counters live in memory and are per Flask process. That is the right size of
answer for this app: a few dozen accounts on one or two instances. A multi
instance deployment would move the store to Redis, and `allow()` is the only
function the rest of the code calls.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window: int = 60) -> bool:
        """True when this caller is still within `limit` hits per `window`."""
        now = time.time()
        cutoff = now - window
        with self._lock:
            bucket = self._hits[key]
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= limit:
                return False
            bucket.append(now)
            # keep the store from growing without bound
            if len(self._hits) > 5000:
                for stale in [k for k, v in self._hits.items() if not v or v[-1] < cutoff]:
                    self._hits.pop(stale, None)
            return True

    def retry_after(self, key: str, window: int = 60) -> int:
        with self._lock:
            bucket = self._hits.get(key)
            if not bucket:
                return 0
            return max(1, int(window - (time.time() - bucket[0])))

    def reset(self, key: str | None = None) -> None:
        with self._lock:
            if key is None:
                self._hits.clear()
            else:
                self._hits.pop(key, None)


limiter = RateLimiter()


def client_key(request, scope: str = "") -> str:
    """Identify the caller.

    Prefers the proxy-supplied client IP, because behind Vercel
    request.remote_addr is the proxy and would otherwise put every visitor
    in one bucket and lock everyone out together.
    """
    forwarded = request.headers.get("X-Forwarded-For", "")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.remote_addr or "unknown")
    return f"{scope}:{ip}"