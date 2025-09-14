import os
from contextlib import contextmanager
from typing import Iterator, Optional

from sqlmodel import SQLModel, Session, create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool


_engine: Optional[Engine] = None
_engine_url: Optional[str] = None


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
    if os.getenv("SQLMODEL_CREATE_ALL", "0") in ("1", "true", "TRUE"):
        SQLModel.metadata.create_all(get_engine())


@contextmanager
def get_session_ctx() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session


def get_session() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session


def is_postgres() -> bool:
    try:
        name = get_engine().url.get_backend_name()  # type: ignore[attr-defined]
    except Exception:
        # Fallback parse
        database_url = os.getenv("DATABASE_URL", "sqlite:///./dev.db")
        name = (database_url.split(":", 1)[0] if ":" in database_url else "")
    return name.startswith("postgres")
