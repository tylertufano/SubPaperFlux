from typing import Callable, Dict, Protocol, Any


class JobHandler(Protocol):
    def __call__(self, *, job_id: str, owner_user_id: str | None, payload: dict) -> Any:  # noqa: D401
        """Handle a job by ID with given payload and owner context."""


_REGISTRY: Dict[str, JobHandler] = {}


def register_handler(job_type: str, handler: JobHandler) -> None:
    _REGISTRY[job_type] = handler


def get_handler(job_type: str) -> JobHandler | None:
    return _REGISTRY.get(job_type)


def known_job_types() -> list[str]:
    return list(_REGISTRY.keys())

