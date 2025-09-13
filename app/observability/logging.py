import json
import logging
import os
import time
import uuid
from contextvars import ContextVar
from typing import Any, Dict

from pythonjsonlogger import jsonlogger


request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)
job_id_ctx: ContextVar[str | None] = ContextVar("job_id", default=None)


class ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:  # noqa: D401
        rid = request_id_ctx.get()
        jid = job_id_ctx.get()
        if rid:
            record.request_id = rid
        if jid:
            record.job_id = jid
        return True


def setup_logging() -> None:
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    logger = logging.getLogger()
    logger.setLevel(level)
    # Clear default handlers
    logger.handlers = []
    handler = logging.StreamHandler()
    fmt = jsonlogger.JsonFormatter("%(asctime)s %(levelname)s %(name)s %(message)s %(request_id)s %(job_id)s")
    handler.setFormatter(fmt)
    handler.addFilter(ContextFilter())
    logger.addHandler(handler)


def bind_request_id(req_id: str | None = None) -> str:
    rid = req_id or str(uuid.uuid4())
    request_id_ctx.set(rid)
    return rid


def bind_job_id(job_id: str | None) -> None:
    job_id_ctx.set(job_id)

