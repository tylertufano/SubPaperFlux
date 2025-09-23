from .registry import register_handler, get_handler, known_job_types

# Ensure built-in job handlers are registered when the package is imported.
# These imports have side effects that populate the registry.
from . import login as _login  # noqa: F401
from . import miniflux as _miniflux  # noqa: F401
from . import publish as _publish  # noqa: F401
from . import retention as _retention  # noqa: F401
from . import rss as _rss  # noqa: F401

__all__ = [
    "register_handler",
    "get_handler",
    "known_job_types",
]

