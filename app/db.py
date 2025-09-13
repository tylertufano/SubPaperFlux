import os
from contextlib import contextmanager
from typing import Iterator

from sqlmodel import SQLModel, Session, create_engine


DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./dev.db")

# SQLite needs check_same_thread=False for multi-threaded FastAPI dev server
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, echo=False, connect_args=connect_args)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


@contextmanager
def get_session_ctx() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


def is_postgres() -> bool:
    try:
        name = engine.url.get_backend_name()  # type: ignore[attr-defined]
    except Exception:
        # Fallback parse
        name = (DATABASE_URL.split(":", 1)[0] if ":" in DATABASE_URL else "")
    return name.startswith("postgres")
