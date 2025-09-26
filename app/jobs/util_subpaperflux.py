import json
import logging
import os
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timezone

from sqlmodel import select

from ..audit import record_audit_log
from ..db import get_session_ctx
from ..models import (
    Bookmark as BookmarkModel,
    Cookie as CookieModel,
    Credential as CredentialModel,
    Feed as FeedModel,
    SiteConfig as SiteConfigModel,
)
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


_SITE_LOGIN_PAIR_DELIMITER = "::"


def format_site_login_pair_id(credential_id: str, site_config_id: str) -> str:
    return f"{credential_id}{_SITE_LOGIN_PAIR_DELIMITER}{site_config_id}"


def parse_site_login_pair_id(pair_id: str) -> Tuple[str, str]:
    if not isinstance(pair_id, str) or _SITE_LOGIN_PAIR_DELIMITER not in pair_id:
        raise ValueError("site_login_pair must be in '<credential>::<site_config>' format")
    credential_id, site_config_id = pair_id.split(_SITE_LOGIN_PAIR_DELIMITER, 1)
    credential_id = credential_id.strip()
    site_config_id = site_config_id.strip()
    if not credential_id or not site_config_id:
        raise ValueError("site_login_pair must include credential and site config identifiers")
    return credential_id, site_config_id


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


def _resolve_site_login_context(
    *,
    site_login_pair_id: Optional[str] = None,
    site_login_credential_id: Optional[str] = None,
    owner_user_id: Optional[str],
    config_dir: Optional[str] = None,
) -> Tuple[str, str, Dict[str, Any], Dict[str, Any]]:
    expected_site_config_id: Optional[str] = None
    if site_login_pair_id:
        cred_id, expected_site_config_id = parse_site_login_pair_id(site_login_pair_id)
        if site_login_credential_id and site_login_credential_id != cred_id:
            raise ValueError("Credential id does not match provided site_login_pair")
        site_login_credential_id = cred_id

    if not site_login_credential_id:
        raise ValueError("site_login_credential_id is required")

    resolved_dir = resolve_config_dir(config_dir)
    creds_file = _load_json(os.path.join(resolved_dir, "credentials.json"))
    sites_file = _load_json(os.path.join(resolved_dir, "site_configs.json"))

    credential_data: Dict[str, Any] = {}
    site_config_id: Optional[str] = None
    with get_session_ctx() as session:
        cred_record = session.get(CredentialModel, site_login_credential_id)
        if cred_record is not None:
            if cred_record.kind != "site_login":
                raise ValueError("credential must be of kind 'site_login'")
            if owner_user_id is not None and cred_record.owner_user_id != owner_user_id:
                raise ValueError("site_login credential does not belong to requesting user")
            try:
                credential_data = decrypt_dict(cred_record.data or {})
            except Exception:
                credential_data = {}
            site_config_id = cred_record.site_config_id or site_config_id
        if not credential_data:
            credential_data = creds_file.get(site_login_credential_id) or {}
        if not site_config_id:
            site_config_id = credential_data.get("site_config_id") or expected_site_config_id
        if expected_site_config_id and site_config_id and site_config_id != expected_site_config_id:
            raise ValueError("site_login_pair references mismatched site config")

        site_config: Dict[str, Any] = {}
        sc_record = None
        if site_config_id:
            sc_record = session.get(SiteConfigModel, site_config_id)
        if sc_record:
            site_config = {
                "site_url": sc_record.site_url,
                "username_selector": sc_record.username_selector,
                "password_selector": sc_record.password_selector,
                "login_button_selector": sc_record.login_button_selector,
                "post_login_selector": sc_record.post_login_selector,
                "cookies_to_store": sc_record.cookies_to_store or [],
            }
        elif site_config_id:
            site_config = sites_file.get(site_config_id) or {}

    if not credential_data or not site_config or not site_config_id:
        raise ValueError("Missing login credentials or site config for provided IDs")

    return site_login_credential_id, site_config_id, credential_data, site_config


def _merge_publication_structures(
    *,
    existing_statuses: Optional[Dict[str, Any]],
    existing_flags: Optional[Dict[str, Any]],
    instapaper_id: Optional[str],
    seen_at: str,
    is_paywalled: bool,
    raw_html_content: Optional[str],
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    statuses = dict(existing_statuses or {})
    instapaper_status = dict(statuses.get("instapaper") or {})
    instapaper_status.setdefault("status", "pending")
    instapaper_status["updated_at"] = seen_at
    statuses["instapaper"] = instapaper_status

    flags = dict(existing_flags or {})
    instapaper_flags = dict(flags.get("instapaper") or {})
    instapaper_flags.setdefault("created_at", instapaper_flags.get("last_seen_at") or seen_at)
    instapaper_flags.update(
        {
            "should_publish": True,
            "is_paywalled": bool(is_paywalled),
            "last_seen_at": seen_at,
            "has_raw_html": bool(raw_html_content) or instapaper_flags.get("has_raw_html", False),
        }
    )
    if instapaper_id:
        instapaper_flags["credential_id"] = instapaper_id
    flags["instapaper"] = instapaper_flags

    return statuses, flags


def perform_login_and_save_cookies(
    *,
    site_login_pair_id: str,
    owner_user_id: Optional[str],
) -> Dict[str, Any]:
    spf = _import_spf()

    credential_id, site_config_id, login_credentials, site_config = _resolve_site_login_context(
        site_login_pair_id=site_login_pair_id,
        owner_user_id=owner_user_id,
    )

    cookies = spf.login_and_update(site_config_id, site_config, login_credentials)
    if not cookies:
        raise RuntimeError("Login did not return any cookies")

    # Backward-compat: previously wrote to cookie_state.json. Now store in DB.
    pair_id = format_site_login_pair_id(credential_id, site_config_id)
    encrypted_payload = encrypt_dict({"cookies": cookies})
    encrypted_blob = json.dumps(encrypted_payload)
    expiry_hint = _compute_expiry_hint(cookies)
    now_iso = datetime.now(timezone.utc).isoformat()
    with get_session_ctx() as session:
        stmt = select(CookieModel).where(
            (CookieModel.credential_id == credential_id)
            & (CookieModel.site_config_id == site_config_id)
        )
        existing = session.exec(stmt).first()
        if existing:
            existing.encrypted_cookies = encrypted_blob
            existing.last_refresh = now_iso
            existing.expiry_hint = expiry_hint
            if owner_user_id is not None:
                existing.owner_user_id = owner_user_id
            session.add(existing)
        else:
            new = CookieModel(
                credential_id=credential_id,
                site_config_id=site_config_id,
                owner_user_id=owner_user_id,
                encrypted_cookies=encrypted_blob,
                last_refresh=now_iso,
                expiry_hint=expiry_hint,
            )
            session.add(new)
        session.commit()
    logging.info("Saved cookies to DB for pair=%s", pair_id)
    return {"site_login_pair": pair_id, "cookies_saved": len(cookies)}

def _decode_cookie_blob(blob: Optional[Any]) -> List[Dict[str, Any]]:
    payload = blob
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            payload = None
    if isinstance(payload, dict) and is_encrypted(payload):
        try:
            payload = decrypt_dict(payload)
        except Exception:
            payload = None
    if isinstance(payload, dict):
        cookies = payload.get("cookies")
        if isinstance(cookies, list):
            return cookies
    return []


def _get_cookies_for_pair(credential_id: str, site_config_id: str) -> List[Dict[str, Any]]:
    if not credential_id or not site_config_id:
        return []
    with get_session_ctx() as session:
        stmt = select(CookieModel).where(
            (CookieModel.credential_id == credential_id)
            & (CookieModel.site_config_id == site_config_id)
        )
        rec = session.exec(stmt).first()
        if not rec:
            return []
        return _decode_cookie_blob(rec.encrypted_cookies)


def get_cookies_for_site_login_pair(
    site_login_pair_id: str, owner_user_id: Optional[str]
) -> List[Dict[str, Any]]:
    if not site_login_pair_id:
        return []
    credential_id, site_config_id = parse_site_login_pair_id(site_login_pair_id)
    with get_session_ctx() as session:
        cred = session.get(CredentialModel, credential_id)
        if not cred or cred.kind != "site_login":
            return []
        if owner_user_id is not None and cred.owner_user_id != owner_user_id:
            return []
        if cred.site_config_id and cred.site_config_id != site_config_id:
            raise ValueError("site_login_pair references mismatched site config")
    return _get_cookies_for_pair(credential_id, site_config_id)

def parse_lookback_to_seconds(s: str) -> int:
    import re
    v = int(re.findall(r"\d+", s)[0])
    u = re.findall(r"[a-z]", s)[0].lower()
    return v if u == "s" else v*60 if u == "m" else v*3600 if u == "h" else v*86400

def poll_rss_and_publish(
    *,
    instapaper_id: Optional[str] = None,
    feed_id: str,
    lookback: Optional[str] = None,
    is_paywalled: Optional[bool] = None,
    rss_requires_auth: Optional[bool] = None,
    site_login_pair_id: Optional[str] = None,
    owner_user_id: Optional[str] = None,
) -> Dict[str, int]:
    spf = _import_spf()
    from datetime import datetime, timezone, timedelta

    resolved_dir = resolve_config_dir()
    instapaper_cfg: Dict[str, Any] = {}
    app_creds: Dict[str, Any] = {}
    if instapaper_id:
        app_creds_file = _load_json(os.path.join(resolved_dir, "instapaper_app_creds.json")) or {}
        credentials_file = _load_json(os.path.join(resolved_dir, "credentials.json"))
        instapaper_cfg_file = {}
        if isinstance(credentials_file, dict):
            instapaper_cfg_file = credentials_file.get(instapaper_id) or {}
        instapaper_cfg = _get_db_credential(instapaper_id, owner_user_id) or instapaper_cfg_file
        app_creds = _get_db_credential_by_kind("instapaper_app", owner_user_id) or app_creds_file


    with get_session_ctx() as session:
        feed = session.get(FeedModel, feed_id)
        if not feed:
            raise ValueError("Feed not found for provided feed_id")
        if owner_user_id is not None and feed.owner_user_id != owner_user_id:
            raise ValueError("Feed does not belong to requesting user")
        feed_url = feed.url
        feed_poll_frequency = feed.poll_frequency or "1h"
        feed_lookback = feed.initial_lookback_period or "24h"
        feed_is_paywalled = feed.is_paywalled
        feed_requires_auth = feed.rss_requires_auth
        feed_site_config_id = feed.site_config_id
        feed_site_config = None
        if feed_site_config_id:
            sc = session.get(SiteConfigModel, feed_site_config_id)
            if sc:
                feed_site_config = {
                    "sanitizing_criteria": sc.cookies_to_store or [],
                }

    effective_lookback = lookback or feed_lookback or "24h"
    effective_is_paywalled = feed_is_paywalled if is_paywalled is None else is_paywalled
    effective_requires_auth = feed_requires_auth if rss_requires_auth is None else rss_requires_auth

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
        "poll_frequency": feed_poll_frequency,
        "initial_lookback_period": effective_lookback,
        "is_paywalled": effective_is_paywalled,
        "rss_requires_auth": effective_requires_auth,
    })

    # State with last_rss_timestamp set by lookback
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=parse_lookback_to_seconds(effective_lookback))
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
    cookies: List[Dict[str, Any]] = []
    if site_login_pair_id:
        _, resolved_site_config_id, _, resolved_site_config = _resolve_site_login_context(
            site_login_pair_id=site_login_pair_id,
            owner_user_id=owner_user_id,
            config_dir=resolved_dir,
        )
        site_cfg = {
            "sanitizing_criteria": resolved_site_config.get("cookies_to_store") or [],
        }
        cookies = get_cookies_for_site_login_pair(site_login_pair_id, owner_user_id)
    elif feed_site_config:
        site_cfg = feed_site_config
        cookies = []

    new_entries = spf.get_new_rss_entries(
        config_file=os.path.join(resolved_dir, "adhoc.ini"),
        feed_url=feed_url,
        instapaper_config=instapaper_cfg,
        app_creds=app_creds,
        rss_feed_config=rss_ini,
        instapaper_ini_config=instapaper_ini,
        cookies=cookies,
        state=state,
        site_config=site_cfg,
    )

    stored = 0
    duplicates = 0
    total_entries = len(new_entries)

    with get_session_ctx() as session:
        for entry in new_entries:
            url = entry.get("url")
            if not url:
                continue

            seen_at = datetime.now(timezone.utc).isoformat()

            published_at_value = entry.get("published_dt")
            if isinstance(published_at_value, str):
                try:
                    published_at_value = datetime.fromisoformat(published_at_value)
                except Exception:
                    published_at_value = None

            rss_entry_metadata = entry.get("rss_entry_metadata") or {}
            feed_meta = rss_entry_metadata.get("feed") or {}
            if feed_id:
                feed_meta.setdefault("id", feed_id)
            feed_meta.setdefault("url", feed_url)
            rss_entry_metadata["feed"] = feed_meta
            rss_entry_metadata["ingested_at"] = seen_at
            rss_entry_metadata["is_paywalled"] = bool(effective_is_paywalled)

            raw_html_content = entry.get("raw_html_content")

            stmt = (
                select(BookmarkModel)
                .where(
                    (BookmarkModel.owner_user_id == owner_user_id)
                    & (BookmarkModel.url == url)
                    & (
                        (BookmarkModel.feed_id == feed_id)
                        | (BookmarkModel.feed_id.is_(None))
                    )
                )
                .order_by(BookmarkModel.published_at.desc(), BookmarkModel.id.desc())
            )
            existing = session.exec(stmt).first()

            if existing:
                duplicates += 1
                changed = False

                merged_metadata = dict(existing.rss_entry or {})
                merged_metadata.update(rss_entry_metadata)
                if merged_metadata != existing.rss_entry:
                    existing.rss_entry = merged_metadata
                    changed = True

                if raw_html_content and raw_html_content != (existing.raw_html_content or ""):
                    existing.raw_html_content = raw_html_content
                    changed = True

                publication_statuses, publication_flags = _merge_publication_structures(
                    existing_statuses=existing.publication_statuses,
                    existing_flags=existing.publication_flags,
                    instapaper_id=instapaper_id,
                    seen_at=seen_at,
                    is_paywalled=effective_is_paywalled,
                    raw_html_content=raw_html_content,
                )

                if publication_statuses != existing.publication_statuses:
                    existing.publication_statuses = publication_statuses
                    changed = True

                if publication_flags != existing.publication_flags:
                    existing.publication_flags = publication_flags
                    changed = True

                if changed:
                    session.add(existing)
                    session.commit()
                continue

            publication_statuses, publication_flags = _merge_publication_structures(
                existing_statuses=None,
                existing_flags=None,
                instapaper_id=instapaper_id,
                seen_at=seen_at,
                is_paywalled=effective_is_paywalled,
                raw_html_content=raw_html_content,
            )

            bm = BookmarkModel(
                owner_user_id=owner_user_id,
                instapaper_bookmark_id=None,
                url=url,
                title=entry.get("title"),
                content_location=None,
                feed_id=feed_id,
                published_at=published_at_value,
                rss_entry=rss_entry_metadata,
                raw_html_content=raw_html_content,
                publication_statuses=publication_statuses,
                publication_flags=publication_flags,
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
                    "source": "rss_ingest",
                    "feed_id": feed_id,
                    "publication_statuses": publication_statuses,
                    "publication_flags": publication_flags,
                },
            )
            session.commit()
            stored += 1

    return {"stored": stored, "duplicates": duplicates, "total": total_entries}


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


def push_miniflux_cookies(
    *,
    miniflux_id: str,
    feed_ids: List[int],
    site_login_pair_id: str,
    owner_user_id: Optional[str],
) -> Dict[str, Any]:
    spf = _import_spf()
    resolved_dir = resolve_config_dir()
    creds = _load_json(os.path.join(resolved_dir, "credentials.json"))
    miniflux_cfg = _get_db_credential(miniflux_id, owner_user_id) or creds.get(miniflux_id) or {}

    credential_id, site_config_id, _, _ = _resolve_site_login_context(
        site_login_pair_id=site_login_pair_id,
        owner_user_id=owner_user_id,
        config_dir=resolved_dir,
    )
    cookies = get_cookies_for_site_login_pair(site_login_pair_id, owner_user_id)
    if not cookies:
        raise RuntimeError("No cookies found for provided site login credential")

    pair_id = format_site_login_pair_id(credential_id, site_config_id)
    ids_str = ",".join(str(i) for i in feed_ids)
    from ..util.ratelimit import limiter as _limiter
    _limiter.wait("miniflux")
    spf.update_miniflux_feed_with_cookies(miniflux_cfg, cookies, config_name=pair_id, feed_ids_str=ids_str)
    return {
        "feed_ids": feed_ids,
        "site_login_pair": pair_id,
        "site_config_id": site_config_id,
    }


def publish_url(
    instapaper_id: str,
    url: str,
    title: Optional[str] = None,
    folder: Optional[str] = None,
    tags: Optional[List[str]] = None,
    owner_user_id: Optional[str] = None,
    config_dir: Optional[str] = None,
    raw_html_content: Optional[str] = None,
) -> Dict[str, Any]:
    spf = _import_spf()
    resolved_dir = resolve_config_dir(config_dir)
    creds = _load_json(os.path.join(resolved_dir, "credentials.json"))
    app_creds_file = _load_json(os.path.join(resolved_dir, "instapaper_app_creds.json"))
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
        raw_html_content=raw_html_content,
        categories_from_feed=[],
        instapaper_ini_config=instapaper_ini_config,
        site_config=None,
        resolve_final_url=True,
    )
    if not result:
        raise RuntimeError("Instapaper publish failed")
    result["deduped"] = False
    return result


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        if cleaned.endswith("Z"):
            cleaned = cleaned[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(cleaned)
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    return None


def _publication_sort_key(bookmark: BookmarkModel) -> Tuple[str, str, str, str]:
    flags = (bookmark.publication_flags or {}).get("instapaper") or {}
    rss_entry = bookmark.rss_entry or {}
    created = str(flags.get("created_at") or flags.get("last_seen_at") or "")
    ingested = str(rss_entry.get("ingested_at") or "")
    published = bookmark.published_at.isoformat() if bookmark.published_at else ""
    return (created, ingested, published, bookmark.id or "")


def iter_pending_instapaper_bookmarks(
    session,
    *,
    owner_user_id: Optional[str],
    instapaper_id: str,
    feed_id: str,
    limit: Optional[int] = None,
    include_paywalled: Optional[bool] = None,
) -> List[BookmarkModel]:
    stmt = select(BookmarkModel).where(BookmarkModel.owner_user_id == owner_user_id)
    stmt = stmt.where(BookmarkModel.feed_id == feed_id)
    rows = session.exec(stmt).all()
    pending: List[BookmarkModel] = []
    for bookmark in rows:
        flags = (bookmark.publication_flags or {}).get("instapaper") or {}
        if not flags.get("should_publish"):
            continue
        credential_id = flags.get("credential_id")
        if credential_id and str(credential_id) != str(instapaper_id):
            continue
        if include_paywalled is not None and bool(flags.get("is_paywalled")) != include_paywalled:
            continue
        statuses = (bookmark.publication_statuses or {}).get("instapaper") or {}
        status_value = str(statuses.get("status") or "pending").lower()
        if status_value == "published":
            continue
        pending.append(bookmark)
    pending.sort(key=_publication_sort_key)
    if limit is not None:
        try:
            parsed_limit = int(limit)
        except (TypeError, ValueError):
            parsed_limit = None
        if parsed_limit is not None and parsed_limit >= 0:
            pending = pending[:parsed_limit]
    return pending


def apply_publication_result(
    bookmark: BookmarkModel,
    *,
    instapaper_id: str,
    job_id: str,
    result: Optional[Dict[str, Any]] = None,
    error: Optional[BaseException] = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    statuses = dict(bookmark.publication_statuses or {})
    instapaper_status = dict(statuses.get("instapaper") or {})
    instapaper_status["credential_id"] = instapaper_id
    instapaper_status["updated_at"] = now_iso

    flags = dict(bookmark.publication_flags or {})
    instapaper_flags = dict(flags.get("instapaper") or {})
    instapaper_flags.setdefault("should_publish", True)
    instapaper_flags.setdefault("created_at", instapaper_flags.get("last_seen_at") or now_iso)
    instapaper_flags.setdefault("credential_id", instapaper_id)

    if result is not None:
        instapaper_status["status"] = "published"
        instapaper_status["deduped"] = bool(result.get("deduped"))
        bookmark_id = result.get("bookmark_id") or instapaper_status.get("bookmark_id")
        if bookmark_id:
            instapaper_status["bookmark_id"] = str(bookmark_id)
            bookmark.instapaper_bookmark_id = str(bookmark_id)
        content_location = result.get("content_location") or instapaper_status.get("content_location")
        if content_location:
            instapaper_status["content_location"] = content_location
            bookmark.content_location = content_location
        published_dt = _parse_iso_datetime(result.get("published_at")) or now
        instapaper_status["published_at"] = published_dt.isoformat()
        bookmark.published_at = published_dt
        instapaper_flags["last_published_at"] = published_dt.isoformat()
        instapaper_flags["last_publish_job_id"] = job_id
        instapaper_flags.pop("last_error_at", None)
        instapaper_flags.pop("last_error_message", None)
    else:
        message = str(error) if error else "Unknown publication error"
        instapaper_status["status"] = "error"
        instapaper_status["error_message"] = message
        instapaper_flags["last_error_at"] = now_iso
        instapaper_flags["last_error_message"] = message

    statuses["instapaper"] = instapaper_status
    flags["instapaper"] = instapaper_flags
    bookmark.publication_statuses = statuses
    bookmark.publication_flags = flags

    return instapaper_status, instapaper_flags
