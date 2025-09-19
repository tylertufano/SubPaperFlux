import logging

from fastapi import FastAPI, HTTPException, Request

from .auth import ensure_admin_role
from .auth.oidc import oidc_startup_event, resolve_user_from_token
from .auth.provisioning import maybe_provision_user
from .config import is_user_mgmt_core_enabled, is_user_mgmt_enforce_enabled
from .db import get_session_ctx, init_db, reset_current_user_id, set_current_user_id
from .routers import status, site_configs, feeds, jobs, credentials, bookmarks, admin
from .routers.admin_audit_v1 import router as admin_audit_v1_router
from .routers.admin_orgs_v1 import router as admin_orgs_v1_router
from .routers.admin_roles_v1 import router as admin_roles_v1_router
from .routers.admin_users_v1 import router as admin_users_v1_router
from .routers.credentials_v1 import router as credentials_v1_router
from .routers.feeds_v1 import router as feeds_v1_router
from .routers.jobs_v1 import router as jobs_v1_router
from .routers.me_tokens_v1 import router as me_tokens_v1_router
from .routers.me_v1 import router as me_v1_router
from .routers.site_configs_v1 import router as site_configs_v1_router
from .routers.integrations import router as integrations_router
from .errors import register_error_handlers
from fastapi.middleware.cors import CORSMiddleware
from .observability.logging import setup_logging, bind_request_id
from .observability.metrics import (
    metrics_endpoint,
    request_metrics_middleware,
    increment_user_login,
)
from .observability.sentry import init_sentry


logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    tags_metadata = [
        {"name": "status", "description": "Service and database health"},
        {"name": "site-configs", "description": "Site configuration CRUD"},
        {"name": "credentials", "description": "User and global credentials"},
        {"name": "feeds", "description": "Feed definitions"},
        {"name": "bookmarks", "description": "Bookmarks listing and management"},
        {"name": "jobs", "description": "Background jobs queue"},
        {"name": "admin", "description": "Administrative operations"},
        {"name": "v1", "description": "Versioned API endpoints"},
    ]
    app = FastAPI(title="SubPaperFlux API", version="0.1.0", openapi_tags=tags_metadata)

    def cache_user_mgmt_flags() -> None:
        core_enabled = is_user_mgmt_core_enabled()
        enforce_enabled = is_user_mgmt_enforce_enabled()
        app.state.user_mgmt_core_enabled = core_enabled
        app.state.user_mgmt_enforce_enabled = enforce_enabled
        app.state.user_mgmt_requires_user_ids = core_enabled or enforce_enabled

    cache_user_mgmt_flags()
    app.state.cache_user_mgmt_flags = cache_user_mgmt_flags

    user_mgmt_core_enabled = app.state.user_mgmt_core_enabled

    # OIDC discovery/JWKS prefetch (optional, lazy fetch also works)
    app.add_event_handler("startup", oidc_startup_event)
    app.add_event_handler("startup", init_db)
    if user_mgmt_core_enabled:

        def ensure_admin_role_startup_task() -> None:
            with get_session_ctx() as session:
                try:
                    ensure_admin_role(session)
                    session.commit()
                except Exception:  # noqa: BLE001
                    session.rollback()
                    logger.exception(
                        "Failed to ensure admin role during startup; continuing without blocking",
                    )
                else:
                    logger.info("Admin role ensured during startup")

        app.add_event_handler("startup", ensure_admin_role_startup_task)
    register_error_handlers(app)
    setup_logging()
    init_sentry(app)

    # Basic CORS defaults (adjust in deployment)
    # CORS from environment configuration
    import os
    origins = os.getenv("CORS_ALLOW_ORIGINS", "*")
    allow_origins = [o.strip() for o in origins.split(",") if o.strip()]
    allow_credentials = os.getenv("CORS_ALLOW_CREDENTIALS", "1") in ("1", "true", "TRUE")
    allow_methods = os.getenv("CORS_ALLOW_METHODS", "*")
    allow_headers = os.getenv("CORS_ALLOW_HEADERS", "*")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=allow_credentials,
        allow_methods=allow_methods.split(",") if "," in allow_methods else [allow_methods],
        allow_headers=allow_headers.split(",") if "," in allow_headers else [allow_headers],
    )
    # Metrics middleware
    app.middleware("http")(request_metrics_middleware)
    # Request ID binder
    @app.middleware("http")
    async def add_request_id(request, call_next):
        rid = request.headers.get("X-Request-Id")
        bind_request_id(rid)
        response = await call_next(request)
        if rid:
            response.headers["X-Request-Id"] = rid
        return response

    @app.middleware("http")
    async def bind_rls_user(request: Request, call_next):
        ctx_token = None
        try:
            core_enabled = getattr(request.app.state, "user_mgmt_core_enabled", False)
            enforce_enabled = getattr(request.app.state, "user_mgmt_enforce_enabled", False)
            requires_user_ids = getattr(
                request.app.state,
                "user_mgmt_requires_user_ids",
                core_enabled or enforce_enabled,
            )
            request.state.user_mgmt_core_enabled = core_enabled
            request.state.user_mgmt_enforce_enabled = enforce_enabled
            request.state.user_mgmt_requires_user_ids = requires_user_ids
            auth_header = request.headers.get("authorization")
            bearer_token = None
            if auth_header:
                parts = auth_header.split(" ", 1)
                if len(parts) == 2 and parts[0].lower() == "bearer":
                    bearer_token = parts[1].strip()
            try:
                user = resolve_user_from_token(bearer_token)
                if user:
                    if requires_user_ids:
                        maybe_provision_user(user, user_mgmt_enabled=requires_user_ids)
                    increment_user_login()
            except HTTPException:
                raise
            except Exception:  # noqa: BLE001
                logger.exception("Failed to resolve user from bearer token")
                user = None
            user_id = user.get("sub") if user else None
            request.state.current_user = user
            request.state.user_id = user_id
            if requires_user_ids:
                ctx_token = set_current_user_id(user_id)
            response = await call_next(request)
            return response
        finally:
            if ctx_token is not None:
                reset_current_user_id(ctx_token)

    # Routers
    app.include_router(status.router)
    app.include_router(site_configs.router, prefix="/site-configs", tags=["site-configs"])
    app.include_router(credentials.router, prefix="/credentials", tags=["credentials"])
    app.include_router(feeds.router, prefix="/feeds", tags=["feeds"])
    app.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
    app.include_router(bookmarks.router)
    app.include_router(admin.router)
    # Prometheus metrics
    app.add_api_route("/metrics", metrics_endpoint, include_in_schema=False)

    # Versioned routers (v1): reuse existing for backward compatibility now
    # v1: enhanced list endpoints with pagination/search
    app.include_router(site_configs_v1_router)
    app.include_router(credentials_v1_router)
    app.include_router(feeds_v1_router)
    app.include_router(jobs.router, prefix="/v1/jobs", tags=["v1"])  # enqueue
    app.include_router(jobs_v1_router)  # list + detail under /v1/jobs
    app.include_router(bookmarks.router, prefix="/v1", tags=["v1"])  # /v1/bookmarks, etc.
    app.include_router(status.router, prefix="/v1", tags=["v1"])  # v1 status
    if user_mgmt_core_enabled:
        app.include_router(admin_audit_v1_router)
        app.include_router(admin_orgs_v1_router)
        app.include_router(admin_roles_v1_router)
        app.include_router(admin_users_v1_router)
    app.include_router(me_v1_router)
    app.include_router(me_tokens_v1_router)
    app.include_router(integrations_router)

    return app


app = create_app()
