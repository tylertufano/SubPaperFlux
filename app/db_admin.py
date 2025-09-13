from typing import Dict

from sqlalchemy import text


def prepare_postgres_search(session) -> Dict:
    """Enable pg_trgm and ensure recommended indexes exist. Returns details."""
    details: Dict = {"actions": []}
    try:
        session.exec(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;")).all()
        details["actions"].append("pg_trgm_extension_ok")
    except Exception as e:  # noqa: BLE001
        details["pg_trgm_error"] = str(e)

    indexes = {
        "ix_bookmark_title_trgm": "CREATE INDEX IF NOT EXISTS ix_bookmark_title_trgm ON bookmark USING gin (LOWER(title) gin_trgm_ops);",
        "ix_bookmark_url_trgm": "CREATE INDEX IF NOT EXISTS ix_bookmark_url_trgm ON bookmark USING gin (LOWER(url) gin_trgm_ops);",
        "ix_bookmark_published_at": "CREATE INDEX IF NOT EXISTS ix_bookmark_published_at ON bookmark (published_at);",
    }
    ensured = {}
    for name, ddl in indexes.items():
        try:
            session.exec(text(ddl)).all()
            ensured[name] = True
        except Exception as e:  # noqa: BLE001
            ensured[name] = False
            details.setdefault("index_errors", {})[name] = str(e)
    details["indexes_ensured"] = ensured
    return details


def enable_rls(session) -> Dict:
    """Enable RLS and create basic owner-based policies.

    Note: Requires Postgres superuser/owner privileges. Assumes app sets app.user_id session var.
    """
    details: Dict = {"tables": {}}
    tables_with_owner = [
        "siteconfig",
        "feed",
        "credential",
        "bookmark",
        "cookie",
        "job",
    ]
    for tbl in tables_with_owner:
        try:
            session.exec(text(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY;")).all()
            # Select policy: allow own rows or global (owner_user_id IS NULL)
            session.exec(text(
                f"CREATE POLICY IF NOT EXISTS {tbl}_select_owner ON {tbl} FOR SELECT USING (owner_user_id IS NULL OR owner_user_id = current_setting('app.user_id', true));"
            )).all()
            # Update/Delete policy: only own rows
            session.exec(text(
                f"CREATE POLICY IF NOT EXISTS {tbl}_mod_owner ON {tbl} FOR UPDATE USING (owner_user_id = current_setting('app.user_id', true));"
            )).all()
            session.exec(text(
                f"CREATE POLICY IF NOT EXISTS {tbl}_del_owner ON {tbl} FOR DELETE USING (owner_user_id = current_setting('app.user_id', true));"
            )).all()
            details["tables"][tbl] = "ok"
        except Exception as e:  # noqa: BLE001
            details["tables"][tbl] = str(e)
    return details
