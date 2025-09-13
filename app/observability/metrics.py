import os
import time
from typing import Callable

from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from starlette.requests import Request
from starlette.responses import Response


REQUEST_COUNTER = Counter(
    "api_requests_total",
    "HTTP requests total",
    ["method", "path", "status"],
)

REQUEST_LATENCY = Histogram(
    "api_request_duration_seconds",
    "HTTP request latency",
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
)

JOB_COUNTER = Counter(
    "jobs_processed_total",
    "Jobs processed",
    ["type", "status"],
)

JOB_DURATION = Histogram(
    "job_duration_seconds",
    "Job processing time",
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60),
)


async def metrics_endpoint(_: Request) -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


async def request_metrics_middleware(request: Request, call_next: Callable):
    start = time.time()
    response = await call_next(request)
    elapsed = time.time() - start
    path = request.url.path
    # avoid high cardinality by trimming numeric ids
    if path.count("/") > 2:
        parts = path.split("/")
        parts = [p if not p.isdigit() else ":id" for p in parts]
        path = "/".join(parts)
    REQUEST_COUNTER.labels(request.method, path, str(response.status_code)).inc()
    REQUEST_LATENCY.observe(elapsed)
    return response

