import json
import logging
import os
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

from sqlmodel import select

from ..audit import record_audit_log
from ..db import get_session_ctx
from ..models import Cookie as CookieModel, Credential as CredentialModel, SiteConfig as SiteConfigModel, Bookmark as BookmarkModel
from ..security.crypto import decrypt_dict, encrypt_dict, is_encrypted


class IniSection:
    """Lightweight adapter to emulate configparser.SectionProxy for get/getboolean."""

    def __init__(self, data: Optional[Dict[str, Any]] = None):
        self._data = data or {}

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def getboolean(self, key: str, fallback: bool = False) -> bool:
        val = self._data.get(key, None)
        if val is None:
            return fallback
        if isinstance(val, bool):
            return val
        if isinstance(val, (int, float)):
            return bool(val)
        s = str(val).strip().lower()
        return s in ("1", "true", "yes", "on")


def _import_spf():
    # Lazy import to avoid heavy init until needed
    import importlib

    return importlib.import_module("subpaperflux")


def _load_json(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        return {}
    with open(path, "r") as f:
        return json.load(f)


def resolve_config_dir(explicit: Optional[str] = None) -> str:
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    for key in ("SPF_CONFIG_DIR", "SUBPAPERFLUX_CONFIG_DIR", "CONFIG_DIR"):
        value = os.getenv(key)
        if value:
            return value
    return "."


def _compute_expiry_hint(cookies: List[Dict[str, Any]]) -> Optional[float]:
    expiries = []
    for c in cookies:
        exp = c.get("expiry") or c.get("expires")
        if isinstance(exp, (int, float)):
            expiries.append(float(exp))
    return min(expiries) if expiries else None


def _get_db_credential(credential_id: str, owner_user_id: Optional[str]) -> Optional[Dict[str, Any]]:
    if not credential_id:
        return None
    with get_session_ctx() as session:
        rec = session.get(CredentialModel, credential_id)
        if rec and (rec.owner_user_id == owner_user_id):
            try:
                return decrypt_dict(rec.data or {})
            except Exception:
                return {}
    return None


def _get_db_credential_by_kind(kind: str, owner_user_id: Optional[str]) -> Optional[Dict[str, Any]]:
    with get_session_ctx() as session:
        # Prefer user-scoped record, then global (owner_user_id is NULL)
        stmt_user = select(CredentialModel).where(
            (CredentialModel.kind == kind) & (CredentialModel.owner_user_id == owner_user_id)
        )
        rec = session.exec(stmt_user).first()
        if rec:
            try:
                return decrypt_dict(rec.data or {})
            except Exception:
                return {}
        stmt_global = select(CredentialModel).where(
            (CredentialModel.kind == kind) & (CredentialModel.owner_user_id.is_(None))
        )
        rec2 = session.exec(stmt_global).first()
        if rec2:
            try:
                return decrypt_dict(rec2.data or {})
            except Exception:
                return {}
    return None


def perform_login_and_save_cookies(config_dir: str, site_config_id: str, credential_id: str, owner_user_id: Optional[str]) -> Dict[str, Any]:
    spf = _import_spf()

    creds = _load_json(os.path.join(config_dir, "credentials.json"))
    sites = _load_json(os.path.join(config_dir, "site_configs.json"))
    # Prefer DB-backed credentials; fallback to file by id key
    login_credentials = _get_db_credential(credential_id, owner_user_id) or creds.get(credential_id) or {}
    # Prefer DB site_config by id; fallback to file by key
    with get_session_ctx() as session:
        sc = session.get(SiteConfigModel, site_config_id)
        if sc:
            site_config = {
                "site_url": sc.site_url,
                "username_selector": sc.username_selector,
                "password_selector": sc.password_selector,
                "login_button_selector": sc.login_button_selector,
                "post_login_selector": sc.post_login_selector,
                "cookies_to_store": sc.cookies_to_store or [],
            }
        else:
            site_config = sites.get(site_config_id) or {}

    if not login_credentials or not site_config:
        raise ValueError("Missing login credentials or site config for provided IDs")

    cookies = spf.login_and_update(site_config_id, site_config, login_credentials)
    if not cookies:
        raise RuntimeError("Login did not return any cookies")

    # Backward-compat: previously wrote to cookie_state.json. Now store in DB.
    cookie_key = f"{credential_id}-{site_config_id}"
    encrypted = encrypt_dict({"cookies": cookies})
    expiry_hint = _compute_expiry_hint(cookies)
    now_iso = datetime.now(timezone.utc).isoformat()
    with get_session_ctx() as session:
        stmt = select(CookieModel).where(
            (CookieModel.credential_id == credential_id)
            & (CookieModel.site_config_id == site_config_id)
        )
        existing = session.exec(stmt).first()
        if not existing:
            stmt = select(CookieModel).where(CookieModel.cookie_key == cookie_key)
            existing = session.exec(stmt).first()
        if existing:
            existing.cookie_key = cookie_key
            existing.credential_id = credential_id
            existing.site_config_id = site_config_id
            existing.cookies = encrypted
            existing.last_refresh = now_iso
            existing.expiry_hint = expiry_hint
            if owner_user_id is not None:
                existing.owner_user_id = owner_user_id
            session.add(existing)
        else:
            new = CookieModel(
                cookie_key=cookie_key,
                credential_id=credential_id,
                site_config_id=site_config_id,
                owner_user_id=owner_user_id,
                cookies=encrypted,
                last_refresh=now_iso,
                expiry_hint=expiry_hint,
            )
            session.add(new)
        session.commit()
    logging.info("Saved cookies to DB for key=%s", cookie_key)
    return {"cookie_key": cookie_key, "cookies_saved": len(cookies)}

def get_cookies_from_db(cookie_key: str) -> List[Dict[str, Any]]:
    with get_session_ctx() as session:
        stmt = select(CookieModel).where(CookieModel.cookie_key == cookie_key)
        rec = session.exec(stmt).first()
        if not rec and "-" in cookie_key:
            cred_id, sc_id = cookie_key.split("-", 1)
            stmt = select(CookieModel).where(
                (CookieModel.credential_id == cred_id)
                & (CookieModel.site_config_id == sc_id)
            )
            rec = session.exec(stmt).first()
        blob = rec.cookies if rec else None
        if isinstance(blob, dict) and is_encrypted(blob):
            try:
                blob = decrypt_dict(blob)
            except Exception:
                blob = None
        return (blob or {}).get("cookies", []) if isinstance(blob, dict) else []

def parse_lookback_to_seconds(s: str) -> int:
    import re
    v = int(re.findall(r"\d+", s)[0])
    u = re.findall(r"[a-z]", s)[0].lower()
    return v if u == "s" else v*60 if u == "m" else v*3600 if u == "h" else v*86400

def poll_rss_and_publish(
    *,
    config_dir: str,
    instapaper_id: str,
    feed_url: str,
    lookback: str = "24h",
    is_paywalled: bool = False,
    rss_requires_auth: bool = False,
    cookie_key: Optional[str] = None,
    site_config_id: Optional[str] = None,
    owner_user_id: Optional[str] = None,
) -> Dict[str, int]:
    spf = _import_spf()
    from datetime import datetime, timezone, timedelta

    app_creds_file = _load_json(os.path.join(config_dir, "instapaper_app_creds.json"))
    instapaper_cfg_file = _load_json(os.path.join(config_dir, "credentials.json")).get(instapaper_id) or {}
    instapaper_cfg = _get_db_credential(instapaper_id, owner_user_id) or instapaper_cfg_file
    app_creds = _get_db_credential_by_kind("instapaper_app", owner_user_id) or app_creds_file

    # Build INI-like sections
    instapaper_ini = IniSection({
        "folder": "",
        "resolve_final_url": True,
        "sanitize_content": True,
        "add_default_tag": True,
        "add_categories_as_tags": True,
    })
    rss_ini = IniSection({
        "feed_url": feed_url,
        "poll_frequency": "1h",
        "initial_lookback_period": lookback,
        "is_paywalled": is_paywalled,
        "rss_requires_auth": rss_requires_auth,
    })

    # State with last_rss_timestamp set by lookback
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=parse_lookback_to_seconds(lookback))
    state = {
        "last_rss_timestamp": cutoff,
        "last_rss_poll_time": cutoff,
        "last_miniflux_refresh_time": cutoff,
        "force_run": False,
        "force_sync_and_purge": False,
        "bookmarks": {},
    }

    # Site config (for sanitization hints)
    site_cfg = None
    if site_config_id:
        with get_session_ctx() as session:
            sc = session.get(SiteConfigModel, site_config_id)
            if sc:
                site_cfg = {
                    "sanitizing_criteria": sc.cookies_to_store or [],
                }

    # Cookies
    cookies = get_cookies_from_db(cookie_key) if cookie_key else []

    new_entries = spf.get_new_rss_entries(
        config_file=os.path.join(config_dir, "adhoc.ini"),
        feed_url=feed_url,
        instapaper_config=instapaper_cfg,
        app_creds=app_creds,
        rss_feed_config=rss_ini,
        instapaper_ini_config=instapaper_ini,
        cookies=cookies,
        state=state,
        site_config=site_cfg,
    )

    published = 0
    for entry in new_entries:
        # Idempotency: dedupe by user + url within window
        try:
            window_sec = int(os.getenv("PUBLISH_DEDUPE_WINDOW_SEC", "86400"))
        except Exception:
            window_sec = 86400
        if owner_user_id and window_sec > 0:
            from datetime import datetime, timezone, timedelta
            since = datetime.now(timezone.utc) - timedelta(seconds=window_sec)
            with get_session_ctx() as session:
                from sqlmodel import select
                stmt = select(BookmarkModel).where(
                    (BookmarkModel.owner_user_id == owner_user_id)
                    & (BookmarkModel.url == entry.get("url"))
                    & ((BookmarkModel.published_at.is_(None)) | (BookmarkModel.published_at >= since))
                )
                exists = session.exec(stmt).first()
                if exists:
                    continue
        # Rate-limit Instapaper publish per item
        from ..util.ratelimit import limiter
        limiter.wait("instapaper")
        res = spf.publish_to_instapaper(
            entry["instapaper_config"],
            entry["app_creds"],
            entry["url"],
            entry["title"],
            entry.get("raw_html_content"),
            entry.get("categories_from_feed", []),
            entry["instapaper_ini_config"],
            entry.get("site_config"),
            resolve_final_url=True,
        )
        if res:
            # Persist bookmark with published timestamp if available
            published += 1
            try:
                with get_session_ctx() as session:
                    bm = BookmarkModel(
                        owner_user_id=owner_user_id,
                        instapaper_bookmark_id=str(res.get("bookmark_id")),
                        url=entry.get("url"),
                        title=res.get("title") or entry.get("title"),
                        content_location=res.get("content_location"),
                        feed_id=None,
                        published_at=(entry.get("published_dt").isoformat() if entry.get("published_dt") else None),
                    )
                    session.add(bm)
                    record_audit_log(
                        session,
                        entity_type="bookmark",
                        entity_id=bm.id,
                        action="create",
                        owner_user_id=bm.owner_user_id,
                        actor_user_id=owner_user_id,
                        details={
                            "instapaper_bookmark_id": bm.instapaper_bookmark_id,
                            "source": "rss_import",
                            "feed_title": entry.get("title"),
                        },
                    )
                    session.commit()
            except Exception:
                # Best-effort persistence; continue
                pass
    return {"published": published, "total": len(new_entries), "skipped": len(new_entries) - published}


def get_instapaper_oauth_session(owner_user_id: Optional[str]):
    from sqlmodel import select
    from requests_oauthlib import OAuth1Session

    with get_session_ctx() as session:
        stmt = select(CredentialModel).where((CredentialModel.owner_user_id == owner_user_id) & (CredentialModel.kind == "instapaper"))
        rec = session.exec(stmt).first()
        app_stmt_user = select(CredentialModel).where((CredentialModel.owner_user_id == owner_user_id) & (CredentialModel.kind == "instapaper_app"))
        app_stmt_global = select(CredentialModel).where((CredentialModel.owner_user_id.is_(None)) & (CredentialModel.kind == "instapaper_app"))
        app = session.exec(app_stmt_user).first() or session.exec(app_stmt_global).first()
    if not rec or not app:
        return None
    user_data = decrypt_dict(rec.data or {})
    app_data = decrypt_dict(app.data or {})
    return OAuth1Session(
        app_data.get("consumer_key"),
        client_secret=app_data.get("consumer_secret"),
        resource_owner_key=user_data.get("oauth_token"),
        resource_owner_secret=user_data.get("oauth_token_secret"),
    )


def get_instapaper_oauth_session_for_id(
    instapaper_cred_id: str, owner_user_id: Optional[str], config_dir: Optional[str] = None
):
    """Create OAuth1Session for a specific instapaper credential id (user-scoped)."""
    from requests_oauthlib import OAuth1Session
    with get_session_ctx() as session:
        rec = session.get(CredentialModel, instapaper_cred_id)
        app_stmt_user = select(CredentialModel).where((CredentialModel.owner_user_id == owner_user_id) & (CredentialModel.kind == "instapaper_app"))
        app_stmt_global = select(CredentialModel).where((CredentialModel.owner_user_id.is_(None)) & (CredentialModel.kind == "instapaper_app"))
        app = session.exec(app_stmt_user).first() or session.exec(app_stmt_global).first()
    if not rec or rec.owner_user_id != owner_user_id:
        return None
    user_data = decrypt_dict(rec.data or {})
    app_data: Dict[str, Any] = {}
    if app:
        try:
            app_data = decrypt_dict(app.data or {}) or {}
        except Exception:
            app_data = {}
    if not app_data:
        resolved_dir = resolve_config_dir(config_dir)
        app_data = _load_json(os.path.join(resolved_dir, "instapaper_app_creds.json")) or {}
    if not app_data:
        return None
    return OAuth1Session(
        app_data.get("consumer_key"),
        client_secret=app_data.get("consumer_secret"),
        resource_owner_key=user_data.get("oauth_token"),
        resource_owner_secret=user_data.get("oauth_token_secret"),
    )


def get_miniflux_config(miniflux_cred_id: str, owner_user_id: Optional[str]) -> Optional[Dict[str, Any]]:
    with get_session_ctx() as session:
        rec = session.get(CredentialModel, miniflux_cred_id)
    if not rec or rec.owner_user_id != owner_user_id or rec.kind != "miniflux":
        return None
    return decrypt_dict(rec.data or {})


def push_miniflux_cookies(config_dir: str, miniflux_id: str, feed_ids: List[int], cookie_key: str, owner_user_id: Optional[str]) -> Dict[str, Any]:
    spf = _import_spf()
    creds = _load_json(os.path.join(config_dir, "credentials.json"))
    miniflux_cfg = _get_db_credential(miniflux_id, owner_user_id) or creds.get(miniflux_id) or {}

    cookies = get_cookies_from_db(cookie_key)
    if not cookies:
        raise RuntimeError("No cookies found for provided cookie_key")

    ids_str = ",".join(str(i) for i in feed_ids)
    from ..util.ratelimit import limiter as _limiter
    _limiter.wait("miniflux")
    spf.update_miniflux_feed_with_cookies(miniflux_cfg, cookies, config_name=cookie_key, feed_ids_str=ids_str)
    return {"feed_ids": feed_ids, "cookie_key": cookie_key}


def publish_url(config_dir: str, instapaper_id: str, url: str, title: Optional[str] = None, folder: Optional[str] = None, tags: Optional[List[str]] = None, owner_user_id: Optional[str] = None) -> Dict[str, Any]:
    spf = _import_spf()
    creds = _load_json(os.path.join(config_dir, "credentials.json"))
    app_creds_file = _load_json(os.path.join(config_dir, "instapaper_app_creds.json"))
    # Fetch user-scoped Instapaper tokens and (optionally) app creds from DB
    instapaper_cfg = _get_db_credential(instapaper_id, owner_user_id) or creds.get(instapaper_id) or {}
    app_creds = _get_db_credential_by_kind("instapaper_app", owner_user_id) or app_creds_file

    instapaper_ini_config = IniSection({
        "folder": folder,
        "tags": ",".join(tags) if tags else "",
        "resolve_final_url": True,
        "sanitize_content": True,
        "add_default_tag": True,
        "add_categories_as_tags": False,
    })

    from ..util.ratelimit import limiter
    limiter.wait("instapaper")
    # Idempotency check for direct publish
    try:
        window_sec = int(os.getenv("PUBLISH_DEDUPE_WINDOW_SEC", "86400"))
    except Exception:
        window_sec = 86400
    if owner_user_id and window_sec > 0:
        from datetime import datetime, timezone, timedelta
        since = datetime.now(timezone.utc) - timedelta(seconds=window_sec)
        with get_session_ctx() as session:
            from sqlmodel import select
            stmt = select(BookmarkModel).where(
                (BookmarkModel.owner_user_id == owner_user_id)
                & (BookmarkModel.url == url)
                & ((BookmarkModel.published_at.is_(None)) | (BookmarkModel.published_at >= since))
            )
            exists = session.exec(stmt).first()
            if exists:
                return {"bookmark_id": exists.instapaper_bookmark_id, "title": title, "content_location": None, "deduped": True}

    result = spf.publish_to_instapaper(
        instapaper_cfg,
        app_creds,
        url,
        title,
        raw_html_content=None,
        categories_from_feed=[],
        instapaper_ini_config=instapaper_ini_config,
        site_config=None,
        resolve_final_url=True,
    )
    if not result:
        raise RuntimeError("Instapaper publish failed")
    result["deduped"] = False
    return result
