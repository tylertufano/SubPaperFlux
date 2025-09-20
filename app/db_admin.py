from typing import Dict

from sqlalchemy import text

from .organization_defaults import (
    DEFAULT_ORGANIZATION_DESCRIPTION,
    DEFAULT_ORGANIZATION_ID,
    DEFAULT_ORGANIZATION_NAME,
    DEFAULT_ORGANIZATION_SLUG,
    ensure_default_organization,
)


def prepare_postgres_search(session) -> Dict:
    """Enable pg_trgm and ensure recommended indexes exist. Returns details."""
    details: Dict = {"actions": []}
    try:
        session.exec(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
        details["actions"].append("pg_trgm_extension_ok")
    except Exception as e:  # noqa: BLE001
        details["pg_trgm_error"] = str(e)

    indexes = {
        "ix_bookmark_title_trgm": "CREATE INDEX IF NOT EXISTS ix_bookmark_title_trgm ON bookmark USING gin (LOWER(title) gin_trgm_ops);",
        "ix_bookmark_url_trgm": "CREATE INDEX IF NOT EXISTS ix_bookmark_url_trgm ON bookmark USING gin (LOWER(url) gin_trgm_ops);",
        "ix_bookmark_published_at": "CREATE INDEX IF NOT EXISTS ix_bookmark_published_at ON bookmark (published_at);",
    }
    ensured: Dict[str, bool] = {}
    for name, ddl in indexes.items():
        try:
            session.exec(text(ddl))
            ensured[name] = True
        except Exception as e:  # noqa: BLE001
            ensured[name] = False
            err = str(e)
            hint = None
            low = err.lower()
            if "permission denied" in low or "must be owner" in low:
                hint = "Requires superuser or table owner privileges to create extension/index"
            details.setdefault("index_errors", {})[name] = {"error": err, **({"hint": hint} if hint else {})}
    details["indexes_ensured"] = ensured
    # Inspect current state: pg_trgm enabled and indexes present
    try:
        has_trgm = session.exec(text("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm')")).scalar()
        details["pg_trgm_enabled"] = bool(has_trgm)
    except Exception as e:  # noqa: BLE001
        details["pg_trgm_check_error"] = str(e)
    try:
        idx_exists = {}
        for name in indexes.keys():
            exists = session.exec(text("SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = :name)").params(name=name)).scalar()
            idx_exists[name] = bool(exists)
        details["indexes"] = idx_exists
    except Exception as e:  # noqa: BLE001
        details["indexes_check_error"] = str(e)
    # Overall ok if extension enabled and all indexes exist
    details["ok"] = bool(details.get("pg_trgm_enabled")) and all(details.get("indexes", {}).values())
    try:
        session.commit()
    except Exception:
        # Commit best-effort; caller may be in autocommit
        pass
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
    policy_definitions: Dict[str, str] = {
        "select_owner": "FOR SELECT USING (owner_user_id IS NULL OR owner_user_id = current_setting('app.user_id', true))",
        "mod_owner": "FOR UPDATE USING (owner_user_id = current_setting('app.user_id', true))",
        "del_owner": "FOR DELETE USING (owner_user_id = current_setting('app.user_id', true))",
    }
    all_ok = True
    for tbl in tables_with_owner:
        tinfo: Dict = {
            "enabled": False,
            "policies": {policy: False for policy in policy_definitions},
        }
        try:
            session.exec(text(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY;"))
            tinfo["enabled"] = True
        except Exception as e:  # noqa: BLE001
            err = str(e)
            low = err.lower()
            hint = None
            if "permission denied" in low or "must be owner" in low:
                hint = "Requires superuser or table owner privileges to enable RLS/policies"
            tinfo["error"] = err
            if hint:
                tinfo["hint"] = hint
            all_ok = False
            details["tables"][tbl] = tinfo
            # Unable to enable RLS; skip policy checks for this table.
            continue

        for policy_key, clause in policy_definitions.items():
            policy_name = f"{tbl}_{policy_key}"
            try:
                exists = session.exec(
                    text(
                        "SELECT 1 FROM pg_policies WHERE schemaname = current_schema() "
                        "AND tablename = :table AND policyname = :policy LIMIT 1"
                    ).params(table=tbl, policy=policy_name)
                ).scalar()
                if not exists:
                    session.exec(text(f"CREATE POLICY {policy_name} ON {tbl} {clause};"))
                tinfo["policies"][policy_key] = True
            except Exception as e:  # noqa: BLE001
                err = str(e)
                low = err.lower()
                hint = None
                if "permission denied" in low or "must be owner" in low:
                    hint = "Requires superuser or table owner privileges to enable RLS/policies"
                tinfo.setdefault("policy_errors", {})[policy_key] = {"error": err, **({"hint": hint} if hint else {})}
                if "error" not in tinfo:
                    tinfo["error"] = err
                if hint and "hint" not in tinfo:
                    tinfo["hint"] = hint
                all_ok = False

        details["tables"][tbl] = tinfo
    try:
        session.commit()
    except Exception:
        pass
    details["ok"] = all_ok and all((t.get("enabled") and all(t.get("policies", {}).values())) for t in details["tables"].values())
    return details
