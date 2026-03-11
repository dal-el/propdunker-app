from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Dict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse


@dataclass
class Bucket:
    tokens: float
    last: float


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory token bucket per client IP.

    capacity: max tokens
    refill_per_sec: tokens added per second

    Note: in prod, replace with Redis/Cloudflare, but this meets MVP "trial-safe".
    """

    def __init__(self, app, capacity: float = 60, refill_per_sec: float = 1.0):
        super().__init__(app)
        self.capacity = float(capacity)
        self.refill_per_sec = float(refill_per_sec)
        self.buckets: Dict[str, Bucket] = {}

    async def dispatch(self, request: Request, call_next):
        ip = request.client.host if request.client else "unknown"
        now = time.time()
        b = self.buckets.get(ip)
        if not b:
            b = Bucket(tokens=self.capacity, last=now)
            self.buckets[ip] = b

        # refill
        elapsed = max(0.0, now - b.last)
        b.tokens = min(self.capacity, b.tokens + elapsed * self.refill_per_sec)
        b.last = now

        if b.tokens < 1.0:
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Rate limit exceeded",
                    "retry_after_seconds": 1,
                },
            )

        b.tokens -= 1.0
        response: Response = await call_next(request)
        return response
