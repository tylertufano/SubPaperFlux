"""Postgres row-level security integration tests.

These tests provision a temporary database owned by a privileged role and run
assertions using the application role to verify that row-level security (RLS)
policies created by :func:`app.db_admin.enable_rls` work as expected.

Running locally requires a Postgres server. A convenient option is the
Docker Compose stub in ``templates/docker-compose.api.example.yml``::

    docker compose -f templates/docker-compose.api.example.yml up -d db
    export TEST_POSTGRES_URL=postgresql+psycopg2://app:app@localhost:5432/app
    pytest tests/test_rls_policies.py -m postgres

When ``TEST_POSTGRES_URL`` (or ``DATABASE_URL``) is unset or points to SQLite,
this module is skipped automatically so that the default SQLite-only test
matrix remains green.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine, make_url
from sqlmodel import Session, SQLModel, select

pytestmark = pytest.mark.postgres


@pytest.fixture(scope="module")
def postgres_rls(monkeypatch):
    """Provision an isolated Postgres database with owner and app roles.

    The fixture creates unique roles and a throwaway database owned by the
    privileged role so the tests can connect as the less privileged
    application role and exercise RLS policies. Resources are dropped after the
    module finishes.
    """

    base_url = os.getenv("TEST_POSTGRES_URL") or os.getenv("DATABASE_URL")
    if not base_url or not base_url.startswith("postgres"):
        pytest.skip(
            "Postgres RLS tests require TEST_POSTGRES_URL (or DATABASE_URL) to point to a Postgres DSN.",
        )

    url = make_url(base_url)
    if not url.username:
        pytest.skip("Postgres DSN must include user credentials")

    driver = url.drivername if url.drivername.startswith("postgresql") else "postgresql+psycopg2"
    host = url.host or "localhost"
    port = url.port or 5432
    admin_db = url.database or "postgres"
    admin_user = url.username
    admin_password = url.password or ""

    pytest.importorskip("psycopg2")
    import psycopg2
    from psycopg2 import sql

    suffix = uuid4().hex[:8]
    owner_role = f"spf_owner_{suffix}"
    owner_password = f"owner_{suffix}"
    app_role = f"spf_app_{suffix}"
    app_password = f"app_{suffix}"
    test_db = f"spf_rls_{suffix}"

    admin_conn = psycopg2.connect(
        dbname=admin_db,
        user=admin_user,
        password=admin_password,
        host=host,
        port=port,
    )
    admin_conn.autocommit = True
    admin_cur = admin_conn.cursor()
    try:
        admin_cur.execute(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(app_role)))
        admin_cur.execute(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(owner_role)))
        admin_cur.execute(
            sql.SQL("CREATE ROLE {} WITH LOGIN PASSWORD %s").format(sql.Identifier(owner_role)),
            [owner_password],
        )
        admin_cur.execute(
            sql.SQL("CREATE ROLE {} WITH LOGIN PASSWORD %s").format(sql.Identifier(app_role)),
            [app_password],
        )
        admin_cur.execute(
            sql.SQL("SELECT pid FROM pg_stat_activity WHERE datname = %s"),
            [test_db],
        )
        for (pid,) in admin_cur.fetchall():
            admin_cur.execute(sql.SQL("SELECT pg_terminate_backend(%s)"), [pid])
        admin_cur.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(test_db)))
        admin_cur.execute(
            sql.SQL("CREATE DATABASE {} OWNER {}").format(
                sql.Identifier(test_db), sql.Identifier(owner_role)
            )
        )
    finally:
        admin_cur.close()
        admin_conn.close()

    owner_conn = psycopg2.connect(
        dbname=test_db,
        user=owner_role,
        password=owner_password,
        host=host,
        port=port,
    )
    owner_conn.autocommit = True
    owner_cur = owner_conn.cursor()
    try:
        owner_cur.execute(sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(sql.Identifier(app_role)))
        owner_cur.execute(
            sql.SQL(
                "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
                "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {}"
            ).format(sql.Identifier(app_role))
        )
        owner_cur.execute(
            sql.SQL(
                "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
                "GRANT USAGE, SELECT ON SEQUENCES TO {}"
            ).format(sql.Identifier(app_role))
        )
    finally:
        owner_cur.close()
        owner_conn.close()

    owner_url = url.set(
        drivername=driver,
        username=owner_role,
        password=owner_password,
        database=test_db,
    )
    app_url = owner_url.set(username=app_role, password=app_password)

    owner_dsn = owner_url.render_as_string(hide_password=False)
    app_dsn = app_url.render_as_string(hide_password=False)

    monkeypatch.setenv("SQLMODEL_CREATE_ALL", "1")
    monkeypatch.setenv("USER_MGMT_RLS_ENFORCE", "1")
    monkeypatch.setenv("DATABASE_URL", owner_dsn)

    from app import db as db_module

    db_module._engine = None  # type: ignore[attr-defined]
    db_module._engine_url = None  # type: ignore[attr-defined]

    owner_engine = db_module.get_engine()
    SQLModel.metadata.drop_all(owner_engine)
    SQLModel.metadata.create_all(owner_engine)

    # Switch default session to the app role for test operations.
    monkeypatch.setenv("DATABASE_URL", app_dsn)
    db_module._engine = None  # type: ignore[attr-defined]
    db_module._engine_url = None  # type: ignore[attr-defined]

    yield {
        "db": db_module,
        "owner_engine": owner_engine,
        "owner_url": owner_dsn,
        "app_url": app_dsn,
        "test_db": test_db,
        "owner_role": owner_role,
        "app_role": app_role,
        "host": host,
        "port": port,
        "admin_db": admin_db,
        "admin_user": admin_user,
        "admin_password": admin_password,
    }

    try:
        db_module.get_engine().dispose()
    except Exception:
        pass
    try:
        owner_engine.dispose()
    except Exception:
        pass

    admin_conn = psycopg2.connect(
        dbname=admin_db,
        user=admin_user,
        password=admin_password,
        host=host,
        port=port,
    )
    admin_conn.autocommit = True
    admin_cur = admin_conn.cursor()
    try:
        admin_cur.execute(
            sql.SQL("SELECT pid FROM pg_stat_activity WHERE datname = %s"),
            [test_db],
        )
        for (pid,) in admin_cur.fetchall():
            admin_cur.execute(sql.SQL("SELECT pg_terminate_backend(%s)"), [pid])
        admin_cur.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(test_db)))
        admin_cur.execute(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(app_role)))
        admin_cur.execute(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(owner_role)))
    finally:
        admin_cur.close()
        admin_conn.close()


@contextmanager
def session_as(db_module, user_id: str | None) -> Iterator[Session]:
    """Context manager that binds ``app.user_id`` for :mod:`app.db` sessions."""

    token = db_module.set_current_user_id(user_id)
    try:
        with next(db_module.get_session()) as session:
            yield session
    finally:
        db_module.reset_current_user_id(token)


def test_rls_policies_enforce_owner_access(postgres_rls):
    db_module = postgres_rls["db"]
    owner_engine: Engine = postgres_rls["owner_engine"]

    from app.auth import ADMIN_ROLE_NAME, ensure_admin_role, grant_role
    from app.db_admin import enable_rls
    from app.models import Bookmark, Job, User

    user_one_id = "user-one"
    user_two_id = "user-two"
    admin_user_id = "admin-root"

    with Session(owner_engine) as session:
        user_one = User(id=user_one_id, email="user1@example.com")
        user_two = User(id=user_two_id, email="user2@example.com")
        admin_user = User(id=admin_user_id, email="admin@example.com")
        session.add(user_one)
        session.add(user_two)
        session.add(admin_user)

        ensure_admin_role(session)
        grant_role(session, admin_user_id, ADMIN_ROLE_NAME, create_missing=True)

        bookmark_one = Bookmark(
            owner_user_id=user_one_id,
            instapaper_bookmark_id="bm-user-one",
            title="User One Bookmark",
            url="https://example.com/user-one",
        )
        bookmark_two = Bookmark(
            owner_user_id=user_two_id,
            instapaper_bookmark_id="bm-user-two",
            title="User Two Bookmark",
            url="https://example.com/user-two",
        )
        bookmark_admin = Bookmark(
            owner_user_id=admin_user_id,
            instapaper_bookmark_id="bm-admin",
            title="Admin Bookmark",
            url="https://example.com/admin",
        )
        session.add(bookmark_one)
        session.add(bookmark_two)
        session.add(bookmark_admin)

        job_one = Job(
            owner_user_id=user_one_id,
            type="dummy",
            payload={"job": "one"},
            status="queued",
        )
        job_two = Job(
            owner_user_id=user_two_id,
            type="dummy",
            payload={"job": "two"},
            status="queued",
        )
        job_admin = Job(
            owner_user_id=admin_user_id,
            type="dummy",
            payload={"job": "admin"},
            status="queued",
        )
        session.add(job_one)
        session.add(job_two)
        session.add(job_admin)
        session.commit()

        bookmark_ids = {
            user_one_id: bookmark_one.id,
            user_two_id: bookmark_two.id,
            admin_user_id: bookmark_admin.id,
        }
        job_ids = {
            user_one_id: job_one.id,
            user_two_id: job_two.id,
            admin_user_id: job_admin.id,
        }

    with Session(owner_engine) as session:
        details = enable_rls(session)
        session.commit()
        assert details["tables"]["bookmark"]["enabled"] is True
        assert details["tables"]["job"]["enabled"] is True

    with session_as(db_module, user_one_id) as session:
        rows = session.exec(select(Bookmark)).all()
        assert {row.owner_user_id for row in rows} == {user_one_id}
        assert session.get(Bookmark, bookmark_ids[user_two_id]) is None
        update_other = session.exec(
            text("UPDATE job SET status='dead' WHERE id=:job_id"),
            {"job_id": job_ids[user_two_id]},
        )
        assert update_other.rowcount == 0
        update_own = session.exec(
            text("UPDATE job SET status='dead' WHERE id=:job_id"),
            {"job_id": job_ids[user_one_id]},
        )
        assert update_own.rowcount == 1
        session.rollback()

    with session_as(db_module, user_two_id) as session:
        rows = session.exec(select(Bookmark)).all()
        assert {row.owner_user_id for row in rows} == {user_two_id}
        assert session.get(Bookmark, bookmark_ids[user_one_id]) is None
        update_other = session.exec(
            text("UPDATE job SET status='dead' WHERE id=:job_id"),
            {"job_id": job_ids[user_one_id]},
        )
        assert update_other.rowcount == 0
        update_own = session.exec(
            text("UPDATE job SET status='dead' WHERE id=:job_id"),
            {"job_id": job_ids[user_two_id]},
        )
        assert update_own.rowcount == 1
        session.rollback()

    with Session(owner_engine) as session:
        # Admin (table owner) bypasses RLS policies and can view/update all rows.
        rows = session.exec(select(Bookmark)).all()
        assert {row.owner_user_id for row in rows} == {
            user_one_id,
            user_two_id,
            admin_user_id,
        }
        update_admin = session.exec(
            text("UPDATE job SET status='processing' WHERE id=:job_id"),
            {"job_id": job_ids[user_two_id]},
        )
        assert update_admin.rowcount == 1
        session.rollback()

