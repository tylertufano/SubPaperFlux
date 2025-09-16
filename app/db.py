import logging
import os
from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Iterator, Optional

from sqlalchemy import text
from sqlmodel import SQLModel, Session, create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool


logger = logging.getLogger(__name__)

_engine: Optional[Engine] = None
_engine_url: Optional[str] = None
_current_user_id: ContextVar[Optional[str]] = ContextVar("app_user_id", default=None)


def get_engine():
    """Return a SQLModel engine, creating it if needed."""
    global _engine, _engine_url
    database_url = os.getenv("DATABASE_URL", "sqlite:///./dev.db")
    if _engine is None or database_url != _engine_url:
        connect_args = {}
        engine_kwargs = {"echo": False}
        if database_url.startswith("sqlite"):
            connect_args["check_same_thread"] = False
            if database_url == "sqlite://":
                engine_kwargs["poolclass"] = StaticPool
        _engine = create_engine(database_url, connect_args=connect_args, **engine_kwargs)
        _engine_url = database_url
    return _engine


def init_db() -> None:
    """Optionally create all tables in dev environments.

    In production, rely on Alembic migrations. Enable this dev helper by setting
    SQLMODEL_CREATE_ALL=1 (or 'true').
    """
    database_url = os.getenv("DATABASE_URL", "sqlite:///./dev.db")
    engine = get_engine()
    if database_url == "sqlite://":
        # In-memory sqlite for tests/dev: reset schema each init for isolation
        SQLModel.metadata.drop_all(engine)
        SQLModel.metadata.create_all(engine)
        return
    if os.getenv("SQLMODEL_CREATE_ALL", "0") in ("1", "true", "TRUE"):
        SQLModel.metadata.create_all(engine)


def set_current_user_id(user_id: Optional[str]) -> Token:
    """Bind the current request's user id to the DB context."""

    return _current_user_id.set(user_id)


def reset_current_user_id(token: Token) -> None:
    """Reset the request user id context variable."""

    _current_user_id.reset(token)


def get_current_user_id() -> Optional[str]:
    return _current_user_id.get()


def _configure_rls(session: Session) -> bool:
    if not is_postgres():
        return False

    user_id = _current_user_id.get()
    try:
        if user_id:
            session.exec(text("SET app.user_id = :user_id"), {"user_id": user_id})
        else:
            session.exec(text("RESET app.user_id"))
        return True
    except Exception:  # noqa: BLE001
        logger.debug("Unable to configure app.user_id session variable", exc_info=True)
        return False


def _reset_rls(session: Session) -> None:
    if not is_postgres():
        return
    try:
        session.exec(text("RESET app.user_id"))
    except Exception:  # noqa: BLE001
        logger.debug("Unable to reset app.user_id session variable", exc_info=True)


def _session_scope() -> Iterator[Session]:
    with Session(get_engine()) as session:
        applied = _configure_rls(session)
        try:
            yield session
        finally:
            if applied:
                _reset_rls(session)


@contextmanager
def get_session_ctx() -> Iterator[Session]:
    yield from _session_scope()


def get_session() -> Iterator[Session]:
    yield from _session_scope()


def is_postgres() -> bool:
    try:
        name = get_engine().url.get_backend_name()  # type: ignore[attr-defined]
    except Exception:
        # Fallback parse
        database_url = os.getenv("DATABASE_URL", "sqlite:///./dev.db")
        name = (database_url.split(":", 1)[0] if ":" in database_url else "")
    return name.startswith("postgres")
