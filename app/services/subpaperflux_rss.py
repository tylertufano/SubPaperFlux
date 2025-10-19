"""RSS ingestion helpers extracted from the legacy SubPaperFlux module."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional
from urllib.parse import urlparse

import feedparser
import requests
from bs4 import BeautifulSoup

_DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/127.0.0.0 Safari/537.36"
)

HEADER_OVERRIDE_KEYS = (
    "article_headers",
    "content_headers",
    "http_headers",
    "header_overrides",
    "article_header_overrides",
)


def parse_frequency_to_seconds(freq_str: str) -> int:
    if not freq_str:
        raise ValueError("Frequency string is required")
    freq = freq_str.lower()
    value = int(re.findall(r"\d+", freq)[0])
    unit = re.findall(r"[a-z]", freq)[0]
    if unit == "s":
        return value
    if unit == "m":
        return value * 60
    if unit == "h":
        return value * 3600
    if unit == "d":
        return value * 86400
    raise ValueError(f"Invalid frequency unit in '{freq_str}'. Use s, m, h, or d.")


def _coerce_header_mapping(value: Any) -> Dict[str, str]:
    if not value:
        return {}
    if isinstance(value, dict):
        normalized: Dict[str, str] = {}
        for key, header_value in value.items():
            if header_value is None:
                continue
            header_name = str(key).strip()
            if not header_name:
                continue
            normalized[header_name] = str(header_value)
        return normalized
    if isinstance(value, (list, tuple)):
        normalized: Dict[str, str] = {}
        for item in value:
            if not isinstance(item, (list, tuple)) or len(item) != 2:
                continue
            header_name = str(item[0]).strip()
            header_value = item[1]
            if not header_name or header_value is None:
                continue
            normalized[header_name] = str(header_value)
        return normalized
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            logging.warning(
                "Failed to parse header overrides JSON. Value will be ignored: %s",
                text,
            )
            return {}
        if isinstance(parsed, dict):
            return _coerce_header_mapping(parsed)
        logging.warning(
            "Header overrides JSON must be an object of key/value pairs. Ignoring value.",
        )
        return {}
    return {}


def merge_header_overrides(*candidates: Any) -> Dict[str, str]:
    merged: Dict[str, str] = {}
    for candidate in candidates:
        headers = _coerce_header_mapping(candidate)
        if headers:
            merged.update(headers)
    return merged


class PaywalledContentError(RuntimeError):
    """Raised when a fetched article response indicates paywalled content."""

    def __init__(self, url: str, *, indicator: Optional[str] = None):
        self.url = url
        self.indicator = indicator
        message = "Fetched content appears to be paywalled"
        if indicator:
            message = f"{message} (indicator={indicator})"
        super().__init__(f"{message}: {url}")


def _summarize_cookie_metadata(cookies: Iterable[Dict[str, Any]]) -> List[str]:
    summaries: List[str] = []
    for cookie in cookies or []:
        if not isinstance(cookie, dict):
            continue
        name = cookie.get("name") or "<unnamed>"
        domain = cookie.get("domain") or "<no-domain>"
        summaries.append(f"{name} (domain={domain})")
    return summaries


def _summarize_requests_cookie_jar(cookie_jar: Any) -> List[str]:
    if not cookie_jar:
        return []
    cookie_dicts: List[Dict[str, Any]] = []
    try:
        iterator = iter(cookie_jar)
    except TypeError:
        iterator = []
    for cookie in iterator:
        if cookie is None:
            continue
        name = getattr(cookie, "name", None) or "<unnamed>"
        domain = getattr(cookie, "domain", None) or "<no-domain>"
        cookie_dicts.append({"name": name, "domain": domain})
    if not cookie_dicts:
        return []
    return _summarize_cookie_metadata(cookie_dicts)


def _merge_cookie_dicts(
    existing_cookies: Iterable[Dict[str, Any]],
    new_cookies: Iterable[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    index_by_key: Dict[tuple[Any, Any, Any], int] = {}

    def _normalized_key(cookie_dict: Dict[str, Any]) -> Optional[tuple[Any, Any, Any]]:
        if not isinstance(cookie_dict, dict):
            return None
        name = cookie_dict.get("name")
        if not name:
            return None
        domain = cookie_dict.get("domain")
        path = cookie_dict.get("path")
        return (
            str(name),
            str(domain) if domain is not None else None,
            str(path) if path is not None else None,
        )

    for cookie in existing_cookies or []:
        key = _normalized_key(cookie)
        if key is None:
            continue
        index_by_key[key] = len(merged)
        merged.append(dict(cookie))

    for cookie in new_cookies or []:
        key = _normalized_key(cookie)
        if key is None:
            continue
        payload = dict(cookie)
        existing_index = index_by_key.get(key)
        if existing_index is not None:
            merged[existing_index] = payload
        else:
            index_by_key[key] = len(merged)
            merged.append(payload)

    return merged


def _sanitize_body_preview(body: Optional[str], limit: int = 200) -> str:
    if body is None:
        return ""
    collapsed = " ".join(body.split())
    if len(collapsed) > limit:
        return f"{collapsed[:limit]}…"
    return collapsed


def _extract_key_response_headers(response: requests.Response) -> Dict[str, Any]:
    key_names = [
        "Content-Type",
        "WWW-Authenticate",
        "Location",
        "Cache-Control",
        "Content-Length",
    ]
    headers = getattr(response, "headers", {}) or {}
    sanitized: Dict[str, Any] = {}
    for header in key_names:
        value = headers.get(header)
        if value is not None:
            sanitized[header] = value
    if sanitized:
        return sanitized
    for header, value in headers.items():
        if "cookie" in header.lower():
            continue
        sanitized[header] = value
    return sanitized


def _sanitize_headers_for_logging(headers: Any) -> Dict[str, Any]:
    if not headers:
        return {}
    try:
        iterable = headers.items()
    except AttributeError:
        return {}
    redacted_names = {"cookie", "set-cookie", "authorization", "proxy-authorization"}
    sanitized: Dict[str, Any] = {}
    for name, value in iterable:
        lower = str(name).lower()
        if lower in redacted_names:
            sanitized[str(name)] = "<redacted>"
        else:
            sanitized[str(name)] = value
    return sanitized


def _cookie_domain_matches(hostname: Optional[str], cookie_domain: Optional[str]) -> bool:
    if not cookie_domain:
        return True
    if not hostname:
        return False
    host = hostname.lower()
    domain = str(cookie_domain).lower()
    if domain.startswith("."):
        domain = domain.lstrip(".")
        return host == domain or host.endswith(f".{domain}")
    return host == domain


def _apply_cookies_to_session(
    session: requests.Session,
    cookies: Iterable[Dict[str, Any]],
    *,
    hostname: Optional[str] = None,
) -> None:
    if not cookies:
        logging.debug("No cookies supplied for session attachment.")
        session.headers.pop("Cookie", None)
        return
    for cookie in cookies:
        if not isinstance(cookie, dict):
            continue
        name = cookie.get("name")
        value = cookie.get("value")
        if not name or value is None:
            continue
        domain = cookie.get("domain")
        if domain and hostname and not _cookie_domain_matches(hostname, domain):
            continue
        cookie_payload = {"name": str(name), "value": str(value)}
        if cookie.get("path"):
            cookie_payload["path"] = cookie.get("path")
        if cookie.get("domain"):
            cookie_payload["domain"] = cookie.get("domain")
        session.cookies.set(**cookie_payload)


def _serialize_requests_cookie(cookie: Any) -> Dict[str, Any]:
    payload = {"name": cookie.name, "value": cookie.value}
    if cookie.domain:
        payload["domain"] = cookie.domain
    if cookie.path:
        payload["path"] = cookie.path
    if getattr(cookie, "expires", None) is not None:
        payload["expiry"] = cookie.expires
    if getattr(cookie, "secure", False):
        payload["secure"] = True
    rest = getattr(cookie, "_rest", {}) or {}
    if rest.get("HttpOnly") or rest.get("httponly"):
        payload["httpOnly"] = True
    return payload


def get_article_html_with_cookies(
    url: str,
    cookies: List[Dict[str, Any]],
    *,
    header_overrides: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    if not cookies:
        logging.debug("No cookies provided. Cannot fetch full article HTML.")
        return None

    logging.debug("Attempting to fetch full article HTML from URL: %s", url)
    cookie_metadata = _summarize_cookie_metadata(cookies)
    if cookie_metadata:
        logging.debug(
            "Applying cookies to request: %s",
            ", ".join(cookie_metadata),
        )

    session = requests.Session()
    parsed_url = urlparse(url)
    hostname = parsed_url.hostname if parsed_url else None
    session_headers = merge_header_overrides(
        {"User-Agent": _DEFAULT_USER_AGENT},
        header_overrides,
    )
    if session_headers:
        session.headers.update(session_headers)
        logging.debug(
            "Constructed article request headers (sanitized): %s",
            _sanitize_headers_for_logging(session_headers),
        )
    _apply_cookies_to_session(session, cookies, hostname=hostname)
    session_cookie_summaries = _summarize_requests_cookie_jar(session.cookies)
    if session_cookie_summaries:
        logging.debug(
            "Article fetch session cookies: %s",
            ", ".join(session_cookie_summaries),
        )

    try:
        response = session.get(url, timeout=30)
        response.raise_for_status()

        history_chain = [resp.url for resp in response.history if getattr(resp, "url", None)]
        if getattr(response, "url", None):
            history_chain.append(response.url)
        logging.debug(
            "Received response from %s with status %s. Redirect chain: %s",
            url,
            response.status_code,
            " -> ".join(history_chain) if history_chain else "<none>",
        )

        request_headers = getattr(getattr(response, "request", None), "headers", {}) or {}
        if request_headers:
            logging.debug(
                "Article fetch sent headers (sanitized): %s",
                _sanitize_headers_for_logging(request_headers),
            )
        prepared_request_cookies = getattr(getattr(response, "request", None), "_cookies", None)
        prepared_cookie_summaries = _summarize_requests_cookie_jar(prepared_request_cookies)
        if prepared_cookie_summaries:
            logging.debug(
                "Article fetch sent cookies: %s",
                ", ".join(prepared_cookie_summaries),
            )

        logging.debug(
            "Article fetch response headers: %s",
            _extract_key_response_headers(response),
        )

        response_text = response.text
        response_text_lower = response_text.lower()

        logging.debug(
            "Article fetch response preview (sanitized): %s",
            _sanitize_body_preview(response_text),
        )

        candidate_urls = [resp.url for resp in response.history if getattr(resp, "url", None)]
        candidate_urls.append(getattr(response, "url", ""))

        login_path_tokens = {"login", "signin", "sign-in", "log-in"}
        for candidate in candidate_urls:
            if not candidate:
                continue
            parsed = urlparse(candidate)
            path_tokens = {segment for segment in parsed.path.lower().split("/") if segment}
            query_string = parsed.query.lower()
            if path_tokens & login_path_tokens or any(
                token in query_string for token in login_path_tokens
            ):
                logging.warning(
                    "Fetched content from %s redirected to login URL %s. Treating as unauthenticated response.",
                    url,
                    candidate,
                )
                logging.warning(
                    "Login redirect response preview (sanitized): %s",
                    _sanitize_body_preview(response_text),
                )
                logging.warning(
                    "Login redirect key headers: %s",
                    _extract_key_response_headers(response),
                )
                return None

        paywall_indicators = [
            "<div class=\"paywall\"",
            "data-paywall",
            "subscribe to read",
            "please log in",
            "<h2>Log in or subscribe to read more</h2>",
            '<div class="post-access-notice"',
            'data-testid="paywall-overlay"',
            "this post is for paid subscribers",
            "this post is for subscribers only",
            "only paid subscribers can read this post",
            "only members can read this post",
        ]

        for indicator in paywall_indicators:
            if indicator.lower() in response_text_lower:
                logging.warning(
                    "Fetched content from %s appears to be a paywall or login page (indicator=%s).",
                    url,
                    indicator,
                )
                logging.warning(
                    "Paywall response preview (sanitized): %s",
                    _sanitize_body_preview(response_text),
                )
                logging.warning(
                    "Paywall key headers: %s",
                    _extract_key_response_headers(response),
                )
                raise PaywalledContentError(url, indicator=indicator)

        logging.debug("Successfully fetched article content from %s.", url)
        return response_text
    except requests.exceptions.RequestException as exc:
        logging.error("Error fetching article content with cookies from %s: %s", url, exc)
        if "response" in locals():
            logging.debug("HTTP status code: %s", response.status_code)
            logging.debug("Response body: %s...", response.text[:200])
        return None


def sanitize_html_content(html_content: Optional[str], sanitizing_criteria: Optional[List[str]]) -> Optional[str]:
    selectors = sanitizing_criteria if sanitizing_criteria else ["img"]
    if not html_content or not selectors:
        return html_content
    try:
        soup = BeautifulSoup(html_content, "html.parser")
        removed_count = 0
        for selector in selectors:
            elements = soup.select(selector)
            if not elements:
                continue
            for element in elements:
                logging.debug(
                    "Removing element with selector '%s': %s...",
                    selector,
                    element.prettify()[:100],
                )
                element.decompose()
                removed_count += 1
        logging.info(
            "Sanitization complete. Removed %s elements based on criteria: %s",
            removed_count,
            selectors,
        )
        return str(soup)
    except Exception as exc:  # noqa: BLE001
        logging.error("Failed to sanitize HTML content: %s", exc)
        return html_content


def extract_prefixed_headers(section: Any, prefix: str = "article_header") -> Dict[str, str]:
    if not section:
        return {}
    items: List[tuple[str, Any]] = []
    if hasattr(section, "items"):
        try:
            items = list(section.items())
        except TypeError:
            items = []
    elif hasattr(section, "_data") and isinstance(section._data, dict):
        items = list(section._data.items())
    collected: Dict[str, str] = {}
    for raw_key, value in items:
        if value is None:
            continue
        key = str(raw_key)
        key_lower = key.lower()
        if key_lower.startswith(f"{prefix}."):
            header_name = key.split(".", 1)[1]
        elif key_lower.startswith(f"{prefix}_"):
            header_name = key[len(prefix) + 1 :]
        else:
            continue
        header_name = header_name.replace("_", "-").strip()
        if not header_name:
            continue
        normalized_parts = [part.capitalize() for part in header_name.split("-") if part]
        normalized_name = "-".join(normalized_parts) if normalized_parts else header_name
        collected[normalized_name or header_name] = str(value)
    return collected


def get_new_rss_entries(
    *,
    config_file: str,
    feed_url: str,
    instapaper_config: Dict[str, Any],
    app_creds: Dict[str, Any],
    rss_feed_config: Any,
    instapaper_ini_config: Any,
    cookies: List[Dict[str, Any]],
    state: Dict[str, Any],
    site_config: Optional[Dict[str, Any]],
    header_overrides: Optional[Dict[str, Any]] = None,
    cookie_invalidator: Optional[Callable[[PaywalledContentError], None]] = None,
) -> List[Dict[str, Any]]:
    last_run_dt: datetime = state["last_rss_timestamp"]
    new_entries: List[Dict[str, Any]] = []

    logging.debug("Last RSS entry timestamp from state: %s", last_run_dt.isoformat())

    is_initial_run = last_run_dt == datetime.fromtimestamp(0, tz=timezone.utc)
    cutoff_dt = last_run_dt

    if is_initial_run:
        initial_lookback_str = rss_feed_config.get("initial_lookback_period", "24h")
        try:
            lookback_seconds = parse_frequency_to_seconds(initial_lookback_str)
            cutoff_dt = datetime.now(timezone.utc) - timedelta(seconds=lookback_seconds)
            logging.info(
                "Initial run detected. Limiting sync to entries published after: %s",
                cutoff_dt.isoformat(),
            )
        except ValueError as exc:
            logging.error(
                "Invalid 'initial_lookback_period' value: %s. Defaulting to no limit.",
                exc,
            )

    try:
        rss_requires_auth = rss_feed_config.getboolean("rss_requires_auth", fallback=False)
        is_paywalled = rss_feed_config.getboolean("is_paywalled", fallback=False)

        requires_authenticated_access = rss_requires_auth or is_paywalled
        has_cookies = bool(cookies)

        site_header_candidates: List[Any] = []
        if isinstance(site_config, dict):
            for key in HEADER_OVERRIDE_KEYS:
                if key in site_config:
                    site_header_candidates.append(site_config.get(key))
            selenium_cfg = site_config.get("selenium_config")
            if isinstance(selenium_cfg, dict):
                for key in HEADER_OVERRIDE_KEYS:
                    if key in selenium_cfg:
                        site_header_candidates.append(selenium_cfg.get(key))

        feed_header_candidates: List[Any] = []
        if rss_feed_config:
            for key in HEADER_OVERRIDE_KEYS:
                value = rss_feed_config.get(key)
                if value:
                    feed_header_candidates.append(value)
            prefixed = extract_prefixed_headers(rss_feed_config)
            if prefixed:
                feed_header_candidates.append(prefixed)

        article_header_overrides = merge_header_overrides(
            header_overrides,
            *site_header_candidates,
            *feed_header_candidates,
        )

        if requires_authenticated_access and not has_cookies:
            logging.error(
                "Feed or content is marked as private/paywalled but no cookies are available.",
            )
            raise RuntimeError(
                "Cannot poll RSS feed without authentication cookies when feed/content is private or paywalled."
            )

        if rss_requires_auth and has_cookies:
            logging.info(
                "Feed is marked as private. Fetching RSS feed from %s with cookies.",
                feed_url,
            )
            session = requests.Session()
            session.headers.update({"User-Agent": _DEFAULT_USER_AGENT})
            _apply_cookies_to_session(session, cookies)
            logging.debug(
                "Authenticated feed session headers (sanitized): %s",
                _sanitize_headers_for_logging(session.headers),
            )
            session_cookie_summaries = _summarize_requests_cookie_jar(session.cookies)
            if session_cookie_summaries:
                logging.debug(
                    "Authenticated feed session cookies: %s",
                    ", ".join(session_cookie_summaries),
                )
            feed_response = session.get(feed_url, timeout=30)

            existing_cookie_dicts = list(cookies or [])
            before_name_set = {
                str(cookie.get("name"))
                for cookie in existing_cookie_dicts
                if isinstance(cookie, dict) and cookie.get("name")
            }

            session_cookie_dicts: List[Dict[str, Any]] = []
            session_cookie_jar = getattr(session, "cookies", None)
            if session_cookie_jar:
                try:
                    iterator = iter(session_cookie_jar)
                except TypeError:
                    iterator = []
                for cookie in iterator:
                    if cookie is None:
                        continue
                    try:
                        serialized = _serialize_requests_cookie(cookie)
                    except AttributeError:
                        continue
                    session_cookie_dicts.append(serialized)

            cookies = _merge_cookie_dicts(existing_cookie_dicts, session_cookie_dicts)
            has_cookies = bool(cookies)

            after_name_set = {
                str(cookie.get("name"))
                for cookie in cookies
                if isinstance(cookie, dict) and cookie.get("name")
            }

            logging.debug(
                "Authenticated feed cookie names before merge: %s",
                sorted(before_name_set),
            )
            logging.debug(
                "Authenticated feed cookie names after merge: %s",
                sorted(after_name_set),
            )
            prepared_request = getattr(feed_response, "request", None)
            request_headers = getattr(prepared_request, "headers", {}) or {}
            if request_headers:
                logging.debug(
                    "Authenticated feed fetch sent headers (sanitized): %s",
                    _sanitize_headers_for_logging(request_headers),
                )
            prepared_cookies = getattr(prepared_request, "_cookies", None)
            prepared_cookie_summaries = _summarize_requests_cookie_jar(prepared_cookies)
            if prepared_cookie_summaries:
                logging.debug(
                    "Authenticated feed fetch sent cookies: %s",
                    ", ".join(prepared_cookie_summaries),
                )

            feed_content = feed_response.text
        else:
            logging.info("Fetching public RSS feed from %s", feed_url)
            response = requests.get(feed_url, timeout=30)
            response.raise_for_status()
            feed_content = response.text

        feed = feedparser.parse(feed_content)
        for entry in getattr(feed, "entries", []):
            entry_published = getattr(entry, "published_parsed", None)
            entry_updated = getattr(entry, "updated_parsed", None)
            entry_timestamp = entry_updated or entry_published
            entry_timestamp_dt = None
            if entry_timestamp:
                entry_timestamp_dt = datetime(*entry_timestamp[:6], tzinfo=timezone.utc)
            if entry_timestamp_dt is None:
                entry_timestamp_dt = datetime.now(timezone.utc)
            if entry_timestamp_dt <= cutoff_dt:
                continue

            title = getattr(entry, "title", None) or "Untitled"
            url = getattr(entry, "link", None)
            if not url:
                logging.debug("Skipping entry '%s' with no URL.", title)
                continue

            entry_categories = set()
            categories = getattr(entry, "tags", None) or []
            for tag in categories:
                label = getattr(tag, "term", None) or getattr(tag, "label", None)
                if label:
                    entry_categories.add(label)
            if hasattr(entry, "category"):
                entry_categories.add(entry.category)
            categories_list = list(entry_categories)

            entry_summary = getattr(entry, "summary", None) or getattr(entry, "description", None)
            entry_author = getattr(entry, "author", None)
            entry_id = getattr(entry, "id", None) or getattr(entry, "guid", None)
            entry_guid = getattr(entry, "guid", None)

            entry_content_list: List[Dict[str, Any]] = []
            if hasattr(entry, "content"):
                for content_item in entry.content:
                    if isinstance(content_item, dict):
                        entry_content_list.append(
                            {
                                "type": content_item.get("type"),
                                "value": content_item.get("value"),
                                "language": content_item.get("language"),
                            }
                        )
                    else:
                        entry_content_list.append(
                            {
                                "type": getattr(content_item, "type", None),
                                "value": getattr(content_item, "value", None),
                                "language": getattr(content_item, "language", None),
                            }
                        )

            enclosures_list: List[Dict[str, Any]] = []
            if hasattr(entry, "enclosures"):
                for enclosure in entry.enclosures:
                    if isinstance(enclosure, dict):
                        enclosures_list.append(
                            {
                                "href": enclosure.get("href"),
                                "type": enclosure.get("type"),
                                "length": enclosure.get("length"),
                            }
                        )
                    else:
                        enclosures_list.append(
                            {
                                "href": getattr(enclosure, "href", None),
                                "type": getattr(enclosure, "type", None),
                                "length": getattr(enclosure, "length", None),
                            }
                        )

            feed_metadata = {
                "title": getattr(feed.feed, "title", None),
                "link": getattr(feed.feed, "link", None),
                "language": getattr(feed.feed, "language", None),
            }

            rss_entry_metadata = {
                "id": entry_id,
                "guid": entry_guid,
                "title": title,
                "link": url,
                "author": entry_author,
                "summary": entry_summary,
                "published": getattr(entry, "published", None),
                "updated": getattr(entry, "updated", None),
                "published_parsed": entry_timestamp_dt.isoformat()
                if entry_timestamp_dt
                else None,
                "categories": categories_list,
                "content": entry_content_list,
                "enclosures": enclosures_list,
                "feed": feed_metadata,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            }

            raw_html_content = None

            if is_paywalled and cookies:
                logging.info(
                    "Article is paywalled. Attempting to fetch full HTML body with cookies.",
                )
                try:
                    raw_html_content = get_article_html_with_cookies(
                        url, cookies, header_overrides=article_header_overrides
                    )
                except PaywalledContentError as exc:
                    logging.warning(
                        "Detected paywall while fetching %s; marking cookies for refresh.",
                        url,
                    )
                    if callable(cookie_invalidator):
                        try:
                            cookie_invalidator(exc)
                        except Exception:  # noqa: BLE001
                            logging.exception(
                                "Failed to invalidate cookies after paywall detection for %s",
                                url,
                            )
                    raw_html_content = None
            else:
                logging.info(
                    "Article is not paywalled. Sending URL-only request to Instapaper.",
                )

            if raw_html_content or not is_paywalled:
                new_entry = {
                    "config_file": config_file,
                    "url": url,
                    "title": title,
                    "raw_html_content": raw_html_content,
                    "published_dt": entry_timestamp_dt,
                    "categories_from_feed": categories_list,
                    "instapaper_config": instapaper_config,
                    "app_creds": app_creds,
                    "rss_feed_config": rss_feed_config,
                    "instapaper_ini_config": instapaper_ini_config,
                    "site_config": site_config,
                    "rss_entry_metadata": rss_entry_metadata,
                }
                new_entries.append(new_entry)
                logging.info(
                    "Found new entry: '%s' from %s",
                    title,
                    entry_timestamp_dt.isoformat(),
                )
            else:
                logging.warning(
                    "Skipping entry '%s' as no content could be retrieved and it's marked as paywalled.",
                    title,
                )

        logging.info("Found %s new entries from this feed.", len(new_entries))

    except requests.exceptions.RequestException as exc:
        logging.error("Error fetching RSS feed: %s", exc)
        if "response" in locals():
            logging.debug("HTTP status code: %s", feed_response.status_code)
            logging.debug("HTTP response body: %s", feed_response.text)
        raise
    except Exception:
        logging.error("An unexpected error occurred while processing feed.", exc_info=True)
        raise

    return new_entries
