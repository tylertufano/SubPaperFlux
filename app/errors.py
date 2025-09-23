import logging
import traceback
import uuid
from typing import Any, Dict, Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


def _problem(
    *,
    code: str,
    message: str,
    status: int,
    trace_id: str,
    details: Optional[Dict[str, Any]] = None,
) -> JSONResponse:
    body = {
        "type": f"about:blank#{code}",
        "title": message,
        "status": status,
        "code": code,
        "message": message,
        "trace_id": trace_id,
    }
    if details:
        body["details"] = details
    return JSONResponse(body, status_code=status, headers={"X-Trace-Id": trace_id})


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_exc_handler(request: Request, exc: StarletteHTTPException):  # type: ignore[override]
        trace_id = str(uuid.uuid4())
        detail = exc.detail
        if isinstance(detail, dict):
            message = detail.get("message") or detail.get("error") or "HTTP error"
            return _problem(
                code="http_error",
                message=str(message),
                status=exc.status_code,
                trace_id=trace_id,
                details=detail,
            )
        if isinstance(detail, list):
            return _problem(
                code="http_error",
                message="HTTP error",
                status=exc.status_code,
                trace_id=trace_id,
                details={"errors": detail},
            )
        return _problem(code="http_error", message=str(detail), status=exc.status_code, trace_id=trace_id)

    @app.exception_handler(RequestValidationError)
    async def validation_exc_handler(request: Request, exc: RequestValidationError):  # type: ignore[override]
        trace_id = str(uuid.uuid4())
        return _problem(
            code="validation_error",
            message="Request validation failed",
            status=422,
            trace_id=trace_id,
            details={"errors": exc.errors()},
        )

    @app.exception_handler(Exception)
    async def unhandled_exc_handler(request: Request, exc: Exception):  # type: ignore[override]
        trace_id = str(uuid.uuid4())
        logging.exception("Unhandled error: %s", exc)
        return _problem(
            code="internal_error",
            message="An unexpected error occurred",
            status=500,
            trace_id=trace_id,
        )

