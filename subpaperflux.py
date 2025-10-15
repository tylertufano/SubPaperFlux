import sys
import os
import argparse
import configparser
import json
import time
import requests
import re
import logging
from typing import Any, Dict, Optional, Callable
from datetime import datetime, timedelta, timezone
from glob import glob
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import WebDriverException, TimeoutException
from requests_oauthlib import OAuth1Session
from urllib.parse import urlencode, urlparse
from bs4 import BeautifulSoup

from app.integrations.instapaper import get_instapaper_tokens

try:
    import feedparser
except ImportError:
    logging.error(
        "feedparser library not found. Please install it with 'pip install feedparser'."
    )
    sys.exit(1)

# --- Configure Execution Based on Environment Variables ---
DEBUG_LOGGING = os.getenv("DEBUG_LOGGING", "0").lower() in ("1", "true")
ENABLE_SCREENSHOTS = os.getenv("ENABLE_SCREENSHOTS", "0").lower() in ("1", "true")
log_dir = "selenium_logs"
os.makedirs(log_dir, exist_ok=True)

# --- Setup Logging ---
log_level = logging.DEBUG if DEBUG_LOGGING else logging.INFO
logging.basicConfig(
    level=log_level,
    format="[%(asctime)s] %(levelname)s: %(message)s",
    datefmt="[%Y-%m-%d %H:%M:%S]",
)
if DEBUG_LOGGING:
    logging.getLogger("oauthlib").setLevel(logging.DEBUG)
    logging.getLogger("requests_oauthlib").setLevel(logging.DEBUG)

# --- Suppress webdriver-manager logs ---
logging.getLogger("webdriver_manager").setLevel(logging.WARNING)

# --- Setup WebDriver Options and Service ---
options = Options()
options.add_argument("--headless=new")
options.add_argument("--disable-gpu")
options.add_argument("--no-sandbox")
options.add_argument("--window-size=1920,1080")
options.add_argument(
    "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/533.36"
)
options.add_argument("--ignore-certificate-errors")
options.add_argument("--disable-blink-features=AutomationControlled")
options.add_argument("--no-proxy-server")
options.add_argument("--disable-dev-shm-usage")

# Unconditionally define service_log_path before its use
service_log_path = os.devnull
if DEBUG_LOGGING:
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    service_log_path = os.path.join(log_dir, "chromedriver.log")

# Initialize the driver service ONCE at the start
try:
    driver_path = ChromeDriverManager().install()
    service = Service(driver_path, log_output=service_log_path)
except Exception as e:
    logging.error(
        f"Failed to initialize Chrome driver: {e}. Ensure Chrome is installed and updated."
    )
    sys.exit(1)

# --- Instapaper API Constants ---
INSTAPAPER_ADD_URL = "https://www.instapaper.com/api/1.1/bookmarks/add"
INSTAPAPER_FOLDERS_LIST_URL = "https://www.instapaper.com/api/1.1/folders/list"
INSTAPAPER_FOLDERS_ADD_URL = "https://www.instapaper.com/api/1.1/folders/add"
INSTAPAPER_BOOKMARKS_LIST_URL = "https://www.instapaper.com/api/1.1/bookmarks/list"
INSTAPAPER_BOOKMARKS_DELETE_URL = "https://www.instapaper.com/api/1.1/bookmarks/delete"


def parse_frequency_to_seconds(freq_str):
    """
    Parses a frequency string like '1h', '30m', '1d' into seconds.
    """
    if not freq_str:
        return 0
    freq_str = freq_str.lower()
    value = int(re.findall(r"\d+", freq_str)[0])
    unit = re.findall(r"[a-z]", freq_str)[0]

    if unit == "s":
        return value
    elif unit == "m":
        return value * 60
    elif unit == "h":
        return value * 3600
    elif unit == "d":
        return value * 86400
    else:
        raise ValueError(f"Invalid frequency unit in '{freq_str}'. Use s, m, h, or d.")


def load_credentials_from_json(config_dir):
    """
    Loads all credentials and configs from a single credentials.json file.
    Returns the loaded dictionary.
    """
    credentials_file_path = os.path.join(config_dir, "credentials.json")
    if os.path.exists(credentials_file_path):
        try:
            with open(credentials_file_path, "r") as f:
                all_configs = json.load(f)
            logging.info(f"Successfully loaded credentials from credentials.json.")
            return all_configs
        except (IOError, json.JSONDecodeError) as e:
            logging.error(f"Error reading or parsing credentials.json file: {e}")
            return {}
    else:
        logging.error(f"Credentials file {credentials_file_path} not found. Exiting.")
        sys.exit(1)


def load_site_configs_from_json(config_dir):
    """
    Loads all site configurations from a site_configs.json file.
    Returns the loaded dictionary.
    """
    site_configs_file_path = os.path.join(config_dir, "site_configs.json")
    if os.path.exists(site_configs_file_path):
        try:
            with open(site_configs_file_path, "r") as f:
                all_site_configs = json.load(f)
            logging.info(
                f"Successfully loaded site configurations from site_configs.json."
            )
            return all_site_configs
        except (IOError, json.JSONDecodeError) as e:
            logging.error(f"Error reading or parsing site_configs.json file: {e}")
            return {}
    else:
        logging.error(
            f"Site configurations file {site_configs_file_path} not found. Exiting."
        )
        sys.exit(1)


def normalize_site_config_payload(site_config):
    """Ensure site configs use the structured selenium/api payload format."""
    if not isinstance(site_config, dict):
        return {}
    normalized = dict(site_config)
    login_type = normalized.get("login_type") or "selenium"
    normalized["login_type"] = login_type
    required_cookies: list[str] = list(normalized.get("required_cookies") or [])
    if login_type == "selenium":
        selenium_cfg = normalized.get("selenium_config") or {}
        if not selenium_cfg and normalized.get("username_selector"):
            selenium_cfg = {
                "username_selector": normalized.get("username_selector"),
                "password_selector": normalized.get("password_selector"),
                "login_button_selector": normalized.get("login_button_selector"),
                "post_login_selector": normalized.get("post_login_selector"),
                "cookies_to_store": normalized.get("cookies_to_store", []),
            }
        selenium_cfg.setdefault("cookies_to_store", [])
        normalized["selenium_config"] = selenium_cfg
        if not required_cookies:
            required_cookies = list(selenium_cfg.get("cookies_to_store") or [])
    elif login_type == "api":
        api_cfg = normalized.setdefault("api_config", {})
        if not required_cookies:
            required_cookies = list(api_cfg.get("cookies_to_store") or [])
            if not required_cookies:
                cookie_map = api_cfg.get("cookies") or {}
                if cookie_map:
                    required_cookies = list(cookie_map.keys())
    normalized["required_cookies"] = required_cookies
    return normalized


def save_credentials_to_json(config_dir, all_configs):
    """
    Saves the credentials dictionary to credentials.json.
    """
    credentials_file_path = os.path.join(config_dir, "credentials.json")
    try:
        with open(credentials_file_path, "w") as f:
            json.dump(all_configs, f, indent=4)
        logging.info("Successfully saved updated credentials to credentials.json.")
    except IOError as e:
        logging.error(f"Error saving to credentials.json: {e}")


def load_instapaper_app_creds(config_dir):
    """
    Loads the Instapaper application consumer keys from a separate file.
    """
    app_creds_path = os.path.join(config_dir, "instapaper_app_creds.json")
    if os.path.exists(app_creds_path):
        try:
            with open(app_creds_path, "r") as f:
                app_creds = json.load(f)
            logging.info("Successfully loaded Instapaper application credentials.")
            return app_creds
        except (IOError, json.JSONDecodeError) as e:
            logging.error(
                f"Error reading or parsing instapaper_app_creds.json file: {e}"
            )
            return {}
    else:
        logging.error(
            f"Instapaper application credentials file {app_creds_path} not found. Exiting."
        )
        sys.exit(1)


def load_state(config_file):
    """
    Loads the state from the .ctrl file.
    """
    base_name = os.path.splitext(os.path.basename(config_file))[0]
    ctrl_file_path = os.path.join(os.path.dirname(config_file), f"{base_name}.ctrl")
    logging.debug(f"Attempting to load state from: {ctrl_file_path}")

    # Initialize with timezone-aware datetimes
    min_datetime = datetime.fromtimestamp(0, tz=timezone.utc)
    state = {
        "last_rss_timestamp": min_datetime,
        "last_rss_poll_time": min_datetime,
        "last_miniflux_refresh_time": min_datetime,
        "force_run": False,
        "force_sync_and_purge": False,  # New flag for force sync/purge
        "bookmarks": {},  # New key for tracking bookmarks
    }

    if os.path.exists(ctrl_file_path):
        try:
            with open(ctrl_file_path, "r") as f:
                data = json.load(f)

                # Helper function to load a string and make it timezone-aware
                def load_aware_datetime(dt_str):
                    if dt_str:
                        dt_obj = datetime.fromisoformat(dt_str)
                        if (
                            dt_obj.tzinfo is None
                            or dt_obj.tzinfo.utcoffset(dt_obj) is None
                        ):
                            # It's naive, so make it aware in UTC
                            return dt_obj.replace(tzinfo=timezone.utc)
                        return dt_obj
                    return min_datetime

                state["last_rss_timestamp"] = load_aware_datetime(
                    data.get("last_rss_timestamp")
                )
                state["last_rss_poll_time"] = load_aware_datetime(
                    data.get("last_rss_poll_time")
                )
                state["last_miniflux_refresh_time"] = load_aware_datetime(
                    data.get("last_miniflux_refresh_time")
                )

                state["force_run"] = data.get("force_run", False)
                state["force_sync_and_purge"] = data.get(
                    "force_sync_and_purge", False
                )  # Load new flag
                state["bookmarks"] = data.get("bookmarks", {})

            logging.info(
                f"Successfully loaded state for {os.path.basename(config_file)}."
            )
            logging.info(
                f"  - Last RSS entry processed: {state['last_rss_timestamp'].isoformat()}"
            )
            logging.info(
                f"  - Last RSS poll time: {state['last_rss_poll_time'].isoformat()}"
            )
            logging.info(
                f"  - Last Miniflux refresh time: {state['last_miniflux_refresh_time'].isoformat()}"
            )
            logging.debug(f"  - Bookmarks tracked: {len(state['bookmarks'])}")
        except (IOError, json.JSONDecodeError, ValueError) as e:
            logging.warning(
                f"Could not read or parse {ctrl_file_path}. Starting with clean state. Error: {e}"
            )
    else:
        logging.info(
            f"No state file found for {os.path.basename(config_file)}. A new one will be created."
        )

    return state


def save_state(config_file, state):
    """Saves the state to the .ctrl file."""
    base_name = os.path.splitext(os.path.basename(config_file))[0]
    ctrl_file_path = os.path.join(os.path.dirname(config_file), f"{base_name}.ctrl")

    # Convert datetime objects to ISO 8601 strings for JSON serialization
    state_to_save = {
        "last_rss_timestamp": state["last_rss_timestamp"].isoformat(),
        "last_rss_poll_time": state["last_rss_poll_time"].isoformat(),
        "last_miniflux_refresh_time": state["last_miniflux_refresh_time"].isoformat(),
        "force_run": state["force_run"],
        "force_sync_and_purge": state["force_sync_and_purge"],  # Save new flag
        "bookmarks": state["bookmarks"],
    }

    try:
        with open(ctrl_file_path, "w") as f:
            json.dump(state_to_save, f, indent=4)
        logging.debug(f"State successfully saved to {ctrl_file_path}.")
    except IOError as e:
        logging.error(f"Could not save state to {ctrl_file_path}. Error: {e}")


def load_cookies_from_json(config_dir):
    """
    Loads the cookies from a single cookie_state.json file.
    Returns a dictionary with cookies keyed by a unique ID.
    """
    cookie_file_path = os.path.join(config_dir, "cookie_state.json")
    cookies_state = {}
    if os.path.exists(cookie_file_path):
        try:
            with open(cookie_file_path, "r") as f:
                cookies_state = json.load(f)
            logging.info("Successfully loaded cookies from cookie_state.json.")
        except (IOError, json.JSONDecodeError) as e:
            logging.warning(
                f"Could not read or parse {cookie_file_path}. Starting with no cached cookies. Error: {e}"
            )
    else:
        logging.info(f"No cookie state file found. A new one will be created.")
    return cookies_state


def save_cookies_to_json(config_dir, cookies_state):
    """Saves the entire cookies dictionary to cookie_state.json."""
    cookie_file_path = os.path.join(config_dir, "cookie_state.json")
    try:
        with open(cookie_file_path, "w") as f:
            json.dump(cookies_state, f, indent=4)
        logging.debug(f"Cookies state successfully saved to {cookie_file_path}.")
    except IOError as e:
        logging.error(f"Could not save cookies state to {cookie_file_path}. Error: {e}")


def check_cookies_expiry(cookies, required_cookie_names=None):
    """
    Checks if any cookie in the list that is required by the current
    configuration has a Unix timestamp that is in the past.
    Returns True if any required cookie is expired, False otherwise.
    """
    cookies_to_check = cookies
    if required_cookie_names and isinstance(required_cookie_names, list):
        cookies_to_check = [c for c in cookies if c["name"] in required_cookie_names]

    current_time = time.time()
    for cookie in cookies_to_check:
        # Cookies from Selenium have 'expiry', requests cookies have 'expires'
        expiry_timestamp = cookie.get("expiry") or cookie.get("expires")
        if expiry_timestamp and expiry_timestamp <= current_time:
            logging.info(
                f"A required cookie named '{cookie.get('name')}' has expired. Triggering re-login."
            )
            return True
    return False


def update_miniflux_feed_with_cookies(
    miniflux_config_json, cookies, config_name, feed_ids_str
):
    """
    Updates all specified Miniflux feeds with captured cookies.
    """
    if not miniflux_config_json:
        logging.debug(f"Miniflux config missing for {config_name}. Skipping.")
        return

    # NEW: Check if the cookies list is empty before proceeding
    if not cookies:
        logging.warning(
            f"No cookies were provided for {config_name}. Skipping Miniflux cookie update."
        )
        return

    miniflux_url = miniflux_config_json.get("miniflux_url")
    api_key = miniflux_config_json.get("api_key")

    if not all([miniflux_url, api_key, feed_ids_str]):
        logging.warning(
            f"Miniflux configuration (URL, API key or feed ID) is incomplete. Skipping cookie update."
        )
        return

    for feed_id in feed_ids_str.split(","):
        try:
            feed_id = int(feed_id.strip())
        except ValueError:
            logging.warning(
                f"Invalid feed_ids format in Miniflux configuration for {config_name}. Skipping cookie update."
            )
            continue

        logging.info(f"Updating Miniflux Feed {feed_id}")
        api_endpoint = f"{miniflux_url.rstrip('/')}/v1/feeds/{feed_id}"
        headers = {
            "X-Auth-Token": api_key,
            "Content-Type": "application/json",
        }
        cookie_str = "; ".join([f"{c['name']}={c['value']}" for c in cookies])

        logging.debug(f"Updating feed {feed_id} at URL: {api_endpoint}")
        logging.debug(f"Cookies being sent: {cookie_str}")

        payload = {"cookie": cookie_str}

        try:
            response = requests.put(
                api_endpoint, headers=headers, json=payload, timeout=20
            )
            response.raise_for_status()
            logging.info(
                f"Miniflux feed {feed_id} updated successfully with new cookies."
            )
            logging.debug(f"Miniflux API Response Status: {response.status_code}")
            logging.debug(f"Miniflux API Response Body: {response.json()}")
        except requests.exceptions.RequestException as e:
            logging.error(f"Error updating Miniflux feed {feed_id}: {e}")
            if "response" in locals():
                logging.debug(f"Miniflux API Response Text: {response.text}")


def _cookie_domain_matches(hostname: str | None, cookie_domain: str | None) -> bool:
    """Return True if the cookie domain already matches the supplied hostname."""

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


def _apply_cookies_to_session(session, cookies, hostname=None):
    """Attach serialized cookies (dicts) to a requests.Session."""

    if not cookies:
        logging.debug("No cookies supplied for session attachment.")
        session.headers.pop("Cookie", None)
        return

    for cookie in cookies:
        if not isinstance(cookie, dict):
            continue

        name = cookie.get("name")
        value = cookie.get("value")

        if not name:
            logging.debug("Encountered cookie without a name. Skipping.")
            continue

        if value is None:
            logging.debug(f"Cookie '{name}' is missing a value. Skipping.")
            continue

        value_str = value if isinstance(value, str) else str(value)
        if value_str == "":
            logging.debug(f"Cookie '{name}' has an empty value. Skipping.")
            continue

        cookie_variants = [cookie]

        domain = cookie.get("domain")
        domain_str = str(domain) if domain is not None else None

        if hostname and domain_str and not _cookie_domain_matches(hostname, domain_str):
            cloned_cookie = dict(cookie)
            if hostname:
                cloned_cookie["domain"] = hostname
            else:
                cloned_cookie.pop("domain", None)
            cookie_variants.append(cloned_cookie)
            logging.debug(
                "Cookie '%s' domain '%s' does not match hostname '%s'; adding host-specific variant.",
                name,
                domain_str,
                hostname,
            )

        for cookie_variant in cookie_variants:
            cookie_kwargs = {}
            variant_domain = cookie_variant.get("domain")
            path = cookie_variant.get("path")
            expires = cookie_variant.get("expiry") or cookie_variant.get("expires")
            secure = cookie_variant.get("secure")

            if variant_domain:
                cookie_kwargs["domain"] = variant_domain
            if path:
                cookie_kwargs["path"] = path
            if expires:
                cookie_kwargs["expires"] = expires
            if secure is not None:
                cookie_kwargs["secure"] = secure

            logging.debug(
                "Attaching cookie '%s' (domain=%s, path=%s, expires=%s) to session.",
                name,
                cookie_kwargs.get("domain"),
                cookie_kwargs.get("path"),
                cookie_kwargs.get("expires"),
            )

            session.cookies.set(name, value_str, **cookie_kwargs)

    # Ensure the session's default `Cookie` header remains unset so that
    # `requests` continues to apply domain/path scoping logic when preparing
    # individual requests. Any stale header is removed above when no cookies
    # are supplied.
    session.headers.pop("Cookie", None)


def _coerce_header_mapping(value):
    """Normalize various header mapping representations into a dict."""

    if not value:
        return {}

    if isinstance(value, dict):
        normalized = {}
        for key, header_value in value.items():
            if header_value is None:
                continue
            header_name = str(key).strip()
            if not header_name:
                continue
            normalized[header_name] = str(header_value)
        return normalized

    if isinstance(value, (list, tuple)):
        normalized = {}
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
            "Header overrides JSON must be an object of key/value pairs. Ignoring value."
        )
        return {}

    return {}


HEADER_OVERRIDE_KEYS = (
    "article_headers",
    "content_headers",
    "http_headers",
    "header_overrides",
    "article_header_overrides",
)


class PaywalledContentError(RuntimeError):
    """Raised when a fetched article response indicates paywalled content."""

    def __init__(self, url: str, *, indicator: Optional[str] = None):
        self.url = url
        self.indicator = indicator
        message = "Fetched content appears to be paywalled"
        if indicator:
            message = f"{message} (indicator={indicator})"
        super().__init__(f"{message}: {url}")


def merge_header_overrides(*candidates):
    """Merge one or more header override sources into a single mapping."""

    merged: Dict[str, str] = {}
    for candidate in candidates:
        headers = _coerce_header_mapping(candidate)
        if headers:
            merged.update(headers)
    return merged


def _summarize_cookie_metadata(cookies):
    """Return a list of cookie metadata strings without exposing values."""

    summaries = []
    for cookie in cookies or []:
        name = cookie.get("name") or "<unnamed>"
        domain = cookie.get("domain") or "<no-domain>"
        summaries.append(f"{name} (domain={domain})")
    return summaries


def _summarize_requests_cookie_jar(cookie_jar):
    """Generate cookie metadata summaries from a RequestsCookieJar."""

    if not cookie_jar:
        return []

    cookie_dicts = []
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


def _merge_cookie_dicts(existing_cookies, new_cookies):
    """Combine cookie dictionaries, deduplicating by (name, domain, path)."""

    merged = []
    index_by_key = {}

    def _normalized_key(cookie_dict):
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
        cookie_payload = dict(cookie)
        existing_index = index_by_key.get(key)
        if existing_index is not None:
            merged[existing_index] = cookie_payload
        else:
            index_by_key[key] = len(merged)
            merged.append(cookie_payload)

    return merged


def _sanitize_body_preview(body, limit=200):
    """Collapse whitespace and clip the body for safe logging."""

    if body is None:
        return ""

    collapsed = " ".join(body.split())
    if len(collapsed) > limit:
        return f"{collapsed[:limit]}…"
    return collapsed


def _extract_key_response_headers(response):
    """Select a small, non-sensitive subset of response headers for diagnostics."""

    key_names = ["Content-Type", "WWW-Authenticate", "Location", "Cache-Control", "Content-Length"]
    headers = getattr(response, "headers", {}) or {}
    sanitized = {}

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


def _sanitize_headers_for_logging(headers):
    """Redact sensitive headers before emitting them to logs."""

    if not headers:
        return {}

    try:
        iterable = headers.items()
    except AttributeError:
        return {}

    redacted_names = {"cookie", "set-cookie", "authorization", "proxy-authorization"}
    sanitized = {}

    for name, value in iterable:
        if name is None:
            continue

        lower_name = str(name).lower()
        if lower_name in redacted_names:
            sanitized[str(name)] = "<redacted>"
        else:
            sanitized[str(name)] = value

    return sanitized


def get_article_html_with_cookies(url, cookies, header_overrides=None):
    """
    Fetches the full HTML content of an article using authentication cookies.
    Returns the HTML content or None on failure.
    """
    if not cookies:
        logging.debug("No cookies provided. Cannot fetch full article HTML.")
        return None

    logging.debug(f"Attempting to fetch full article HTML from URL: {url}")
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
        {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/127.0.0.0 Safari/537.36"
            )
        },
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

        # Detect whether we were redirected to a login page (indicating auth failure)
        candidate_urls = [resp.url for resp in response.history if getattr(resp, "url", None)]
        candidate_urls.append(getattr(response, "url", ""))

        login_path_tokens = {"login", "signin", "sign-in", "log-in"}
        for candidate in candidate_urls:
            if not candidate:
                continue

            parsed = urlparse(candidate)
            path_tokens = {segment for segment in parsed.path.lower().split("/") if segment}
            query_string = parsed.query.lower()

            if path_tokens & login_path_tokens or any(token in query_string for token in login_path_tokens):
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

        # --- NEW: Check for common paywall indicators ---
        # The log shows a Substact feed, so we'll check for its common paywall classes.
        # This is a good general practice for similar paywalled sites.
        paywall_indicators = [
            'class="paywall"',
            'id="paywall"',
            'class="gated-content"',
            'id="gated-content"',
            "<h2>Sign in to continue reading</h2>",
            "<h2>Subscribe to continue reading</h2>",
            "<h2>Log in or subscribe to read more</h2>",
            '<div class="post-access-notice"',
            'data-testid="paywall-overlay"',
            "this post is for paid subscribers",
            "this post is for subscribers only",
            "only paid subscribers can read this post",
            "only members can read this post",
        ]

        for indicator in paywall_indicators:
            indicator_lower = indicator.lower()
            if indicator_lower in response_text_lower:
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

        logging.debug(f"Successfully fetched article content from {url}.")
        return response_text
    except requests.exceptions.RequestException as e:
        logging.error(f"Error fetching article content with cookies from {url}: {e}")
        if "response" in locals():
            logging.debug(f"HTTP status code: {response.status_code}")
            logging.debug(f"Response body: {response.text[:200]}...")
        return None


def get_instapaper_folder_id(oauth_session, folder_name):
    """
    Checks if a folder with the given name exists and returns its ID.
    Returns the folder ID (str) or None if not found.
    """
    logging.debug(f"Checking for existing folder: '{folder_name}'")
    try:
        response = oauth_session.post(INSTAPAPER_FOLDERS_LIST_URL)
        response.raise_for_status()

        folders = json.loads(response.text)

        for folder in folders:
            if folder.get("title") == folder_name:
                logging.info(
                    f"Found existing folder '{folder_name}' with ID: {folder['folder_id']}"
                )
                return folder["folder_id"]

    except Exception as e:
        logging.error(f"Error listing Instapaper folders: {e}")
        if "response" in locals():
            logging.debug(f"Instapaper API Response Text: {response.text}")

    logging.debug(f"Folder '{folder_name}' not found.")
    return None


def create_instapaper_folder(oauth_session, folder_name):
    """
    Creates a new folder with the given name and returns its ID.
    Returns the new folder ID (str) or None on failure.
    """
    logging.debug(f"Creating new folder: '{folder_name}'")
    try:
        payload = {"title": folder_name}
        response = oauth_session.post(INSTAPAPER_FOLDERS_ADD_URL, data=payload)
        response.raise_for_status()

        new_folder = json.loads(response.text)
        new_id = new_folder[0].get("folder_id")
        if new_id:
            logging.info(
                f"Successfully created new folder '{folder_name}' with ID: {new_id}"
            )
            return new_id
        else:
            logging.error(
                f"Failed to create folder. Response did not contain a folder ID."
            )
            if "response" in locals():
                logging.debug(f"Instapaper API Response Text: {response.text}")
            return None

    except Exception as e:
        logging.error(f"Error creating Instapaper folder: {e}")
        if "response" in locals():
            # Instapaper returns a 400 Bad Request if the folder already exists.
            # We can handle this as a success.
            if response.status_code == 400 and "Folder already exists" in response.text:
                logging.info(
                    f"Folder '{folder_name}' already exists. Handling as success."
                )
                return get_instapaper_folder_id(oauth_session, folder_name)
            logging.debug(f"Instapaper API Response Text: {response.text}")
        return None


def sanitize_html_content(html_content, sanitizing_criteria):
    """
    Sanitizes HTML content by removing elements based on a list of CSS selectors.

    Args:
        html_content (str): The raw HTML content to sanitize.
        sanitizing_criteria (list): A list of CSS selectors for elements to remove.

    Returns:
        str: The sanitized HTML content.
    """
    selectors = sanitizing_criteria if sanitizing_criteria else ["img"]

    if not html_content or not selectors:
        return html_content

    try:
        soup = BeautifulSoup(html_content, "html.parser")

        removed_count = 0
        for selector in selectors:
            elements_to_remove = soup.select(selector)
            if elements_to_remove:
                for element in elements_to_remove:
                    logging.debug(
                        f"Removing element with selector '{selector}': {element.prettify()[:100]}..."
                    )
                    element.decompose()
                    removed_count += 1

        logging.info(
            f"Sanitization complete. Removed {removed_count} elements based on criteria: {selectors}"
        )
        return str(soup)
    except Exception as e:
        logging.error(f"Failed to sanitize HTML content: {e}")
        return html_content


def publish_to_instapaper(
    instapaper_config,
    app_creds,
    url,
    title,
    raw_html_content,
    categories_from_feed,
    instapaper_ini_config,
    site_config,
    resolve_final_url=True,
):
    """
    Publishes a single article entry to Instapaper.
    Returns a dictionary with 'bookmark_id' and 'content_location' on success, or None on failure.
    """
    try:
        consumer_key = app_creds.get("consumer_key")
        consumer_secret = app_creds.get("consumer_secret")
        oauth_token = instapaper_config.get("oauth_token")
        oauth_token_secret = instapaper_config.get("oauth_token_secret")

        if not all([consumer_key, consumer_secret, oauth_token, oauth_token_secret]):
            logging.error("Incomplete Instapaper credentials. Cannot publish.")
            return None

        oauth = OAuth1Session(
            consumer_key,
            client_secret=consumer_secret,
            resource_owner_key=oauth_token,
            resource_owner_secret=oauth_token_secret,
        )

        payload = {
            "url": url,
            "title": title,
        }

        # --- CORRECTED SANITIZATION LOGIC ---
        sanitize_content_flag = instapaper_ini_config.getboolean(
            "sanitize_content", fallback=True
        )
        processed_content = raw_html_content

        if raw_html_content:
            if sanitize_content_flag:
                logging.debug("Content sanitization is explicitly ENABLED.")
                sanitizing_criteria = []

                ini_custom_criteria = instapaper_ini_config.get(
                    "custom_sanitizing_criteria"
                )
                site_custom_criteria = (
                    site_config.get("sanitizing_criteria") if site_config else None
                )

                if ini_custom_criteria:
                    logging.info(
                        "Using custom sanitizing criteria from INI file. This overrides any site configuration."
                    )
                    if isinstance(ini_custom_criteria, str):
                        sanitizing_criteria = [
                            s.strip()
                            for s in ini_custom_criteria.split(",")
                            if s.strip()
                        ]
                    else:
                        sanitizing_criteria = ini_custom_criteria

                elif site_custom_criteria:
                    logging.info(
                        "Using custom sanitizing criteria from site configuration."
                    )
                    sanitizing_criteria = [
                        s.strip() for s in site_custom_criteria if s.strip()
                    ]
                else:
                    logging.info(
                        "Using default sanitizing criteria: removing img tags."
                    )
                    # Default to removing all img tags
                    sanitizing_criteria = ["img"]  # Changed to a valid CSS selector

                processed_content = sanitize_html_content(
                    raw_html_content, sanitizing_criteria
                )
            else:
                logging.debug(
                    "Content sanitization is explicitly DISABLED. Including raw HTML content."
                )

            # Add the (potentially sanitized) content to the payload
            payload["content"] = processed_content
            logging.debug(
                f"Payload includes HTML content (truncated): {payload['content'][:100]}..."
            )

        else:
            logging.debug(
                "Payload does not include HTML content. Instapaper will attempt to resolve the URL."
            )

        # --- END CORRECTED SANITIZATION LOGIC ---

        # Explicitly set resolve_final_url to '0' if the config is false
        if not resolve_final_url:
            payload["resolve_final_url"] = "0"

        # --- NEW LOGIC: Order tags for consistency ---
        add_default_tag_flag = instapaper_ini_config.getboolean(
            "add_default_tag", fallback=True
        )
        add_categories_as_tags_flag = instapaper_ini_config.getboolean(
            "add_categories_as_tags", fallback=False
        )
        tags_string = instapaper_ini_config.get("tags", "")

        user_defined_tags = []
        if tags_string:
            user_defined_tags = [
                tag.strip() for tag in tags_string.split(",") if tag.strip()
            ]

        category_tags = []
        if add_categories_as_tags_flag and categories_from_feed:
            logging.debug(f"Adding categories as tags: {categories_from_feed}")
            category_tags = list(set(categories_from_feed))

        default_tags = []
        if add_default_tag_flag:
            default_tags.append("RSS")
            logging.debug("Adding default 'RSS' tag.")

        final_tags = user_defined_tags + category_tags + default_tags

        if final_tags:
            tags_list = [{"name": tag} for tag in final_tags]
            payload["tags"] = json.dumps(tags_list)
            logging.debug(f"Formatted tags being sent: '{payload['tags']}'.")
        else:
            logging.debug("No tags will be added to this bookmark.")
        # --- END NEW LOGIC ---

        # Conditionally add folder ID
        folder_id = instapaper_ini_config.get("folder_id")
        if folder_id:
            payload["folder_id"] = folder_id

        logging.debug(f"Publishing URL: {url}")
        logging.debug(f"Publishing Title: {title}")

        if "resolve_final_url" in payload:
            logging.debug(
                "'resolve_final_url' parameter is set to '0' to prevent URL resolution."
            )
        else:
            logging.debug(
                "'resolve_final_url' parameter is not explicitly set. Instapaper will resolve redirects."
            )
        if folder_id:
            logging.debug(f"Folder ID being used: '{folder_id}'.")

        # Log the full payload being sent to the API
        logging.debug(f"Payload being sent to Instapaper: {payload}")

        # Use `data` parameter to send the payload as application/x-www-form-urlencoded
        response = oauth.post(INSTAPAPER_ADD_URL, data=payload)
        response.raise_for_status()

        # Log the raw response text regardless of its content
        logging.debug(f"Raw response text from Instapaper: {response.text}")
        content_location = response.headers.get("Content-Location")
        logging.debug(f"Content-Location header: {content_location}")

        response_json = response.json()
        bookmark_id = None
        for item in response_json:
            if item.get("type") == "bookmark":
                bookmark_id = item.get("bookmark_id")
                break

        if bookmark_id:
            logging.info(
                f"Successfully published '{title}' to Instapaper. Bookmark ID: {bookmark_id}"
            )
            logging.debug(f"Instapaper API Response Status: {response.status_code}")
            return {
                "bookmark_id": bookmark_id,
                "content_location": content_location,
                "title": title,
            }
        else:
            logging.error(
                f"Failed to retrieve bookmark_id from successful response for '{title}'."
            )
            return None

    except Exception as e:
        logging.error(f"Error publishing to Instapaper: {e}")
        if "response" in locals():
            logging.debug(f"Instapaper API Response Text: {response.text}")
        return None


def _extract_prefixed_headers(section, prefix="article_header"):
    """Extract headers from INI sections using `article_header.X` style keys."""

    if not section:
        return {}

    items = []
    if hasattr(section, "items"):
        try:
            items = list(section.items())
        except TypeError:
            items = []
    elif hasattr(section, "_data") and isinstance(section._data, dict):
        items = list(section._data.items())

    collected = {}
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
    config_file,
    feed_url,
    instapaper_config,
    app_creds,
    rss_feed_config,
    instapaper_ini_config,
    cookies,
    state,
    site_config,
    header_overrides=None,
    cookie_invalidator: Optional[Callable[[PaywalledContentError], None]] = None,
):
    """
    Fetches the RSS feed from a given URL and returns a list of new entries.
    Accepts optional `cookies` and `header_overrides` arguments for authenticated
    content fetching.
    """
    last_run_dt = state["last_rss_timestamp"]
    new_entries = []

    logging.debug(f"Last RSS entry timestamp from state: {last_run_dt.isoformat()}")

    # Determine the time cutoff for initial runs
    is_initial_run = last_run_dt == datetime.fromtimestamp(0, tz=timezone.utc)
    cutoff_dt = last_run_dt

    if is_initial_run:
        initial_lookback_str = rss_feed_config.get("initial_lookback_period", "24h")
        try:
            lookback_seconds = parse_frequency_to_seconds(initial_lookback_str)
            cutoff_dt = datetime.now(timezone.utc) - timedelta(seconds=lookback_seconds)
            logging.info(
                f"Initial run detected. Limiting sync to entries published after: {cutoff_dt.isoformat()}"
            )
        except ValueError as e:
            logging.error(
                f"Invalid 'initial_lookback_period' value: {e}. Defaulting to no limit."
            )
            # Keep cutoff_dt as the min_datetime, which means all entries will be fetched.

    try:
        # Load the two new, independent flags
        rss_requires_auth = rss_feed_config.getboolean(
            "rss_requires_auth", fallback=False
        )
        is_paywalled = rss_feed_config.getboolean("is_paywalled", fallback=False)

        requires_authenticated_access = rss_requires_auth or is_paywalled
        has_cookies = bool(cookies)

        site_header_candidates = []
        if isinstance(site_config, dict):
            for key in HEADER_OVERRIDE_KEYS:
                if key in site_config:
                    site_header_candidates.append(site_config.get(key))
            selenium_cfg = site_config.get("selenium_config")
            if isinstance(selenium_cfg, dict):
                for key in HEADER_OVERRIDE_KEYS:
                    if key in selenium_cfg:
                        site_header_candidates.append(selenium_cfg.get(key))

        feed_header_candidates = []
        if rss_feed_config:
            for key in HEADER_OVERRIDE_KEYS:
                value = rss_feed_config.get(key)
                if value:
                    feed_header_candidates.append(value)
            prefixed = _extract_prefixed_headers(rss_feed_config)
            if prefixed:
                feed_header_candidates.append(prefixed)

        article_header_overrides = merge_header_overrides(
            header_overrides,
            *site_header_candidates,
            *feed_header_candidates,
        )

        if requires_authenticated_access and not has_cookies:
            logging.error(
                "Feed or content is marked as private/paywalled but no cookies are available."
            )
            raise RuntimeError(
                "Cannot poll RSS feed without authentication cookies when feed/content is private or paywalled."
            )

        # Determine if we need to use a session with cookies for the RSS feed
        if rss_requires_auth and has_cookies:
            logging.info(
                f"Feed is marked as private. Fetching RSS feed from {feed_url} with cookies."
            )
            session = requests.Session()
            session.headers.update(
                {
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/127.0.0.0 Safari/537.36"
                    )
                }
            )
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

            session_cookie_dicts = []
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
        else:
            logging.info(
                f"Feed is public. Fetching RSS feed from {feed_url} without cookies."
            )
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/533.36"
            }
            feed_response = requests.get(feed_url, headers=headers, timeout=30)
            request_headers = getattr(getattr(feed_response, "request", None), "headers", {}) or {}
            if request_headers:
                logging.debug(
                    "Public feed fetch sent headers (sanitized): %s",
                    _sanitize_headers_for_logging(request_headers),
                )

        feed_response.raise_for_status()
        feed = feedparser.parse(feed_response.content)
        logging.debug(f"Found {len(feed.entries)} entries in the RSS feed.")

        # Extract feed-level categories
        feed_categories = set()
        if hasattr(feed.feed, "tags"):
            for tag in feed.feed.tags:
                if "term" in tag:
                    feed_categories.add(tag["term"])
        if hasattr(feed.feed, "category"):
            feed_categories.add(feed.feed.category)

        logging.debug(f"Feed-level categories: {list(feed_categories)}")

        for entry in feed.entries:
            entry_timestamp_dt = None
            if hasattr(entry, "published_parsed"):
                entry_timestamp_dt = datetime.fromtimestamp(
                    time.mktime(entry.published_parsed), tz=timezone.utc
                )
            elif hasattr(entry, "updated_parsed"):
                entry_timestamp_dt = datetime.fromtimestamp(
                    time.mk.time(entry.updated_parsed), tz=timezone.utc
                )

            logging.debug(
                f"Processing entry '{entry.title}'. Timestamp: {entry_timestamp_dt}"
            )

            # NEW LOGIC: Check against the dynamic cutoff date
            if entry_timestamp_dt and entry_timestamp_dt > cutoff_dt:
                url = entry.link
                title = entry.title

                # Extract entry-specific categories
                entry_categories = set(feed_categories)  # Start with feed categories
                if hasattr(entry, "tags"):
                    for tag in entry.tags:
                        if "term" in tag:
                            entry_categories.add(tag["term"])
                if hasattr(entry, "category"):
                    entry_categories.add(entry.category)

                # Convert to a list for JSON serialization later
                categories_list = list(entry_categories)

                entry_summary = getattr(entry, "summary", None) or getattr(
                    entry, "description", None
                )
                entry_author = getattr(entry, "author", None)
                entry_id = getattr(entry, "id", None) or getattr(entry, "guid", None)
                entry_guid = getattr(entry, "guid", None)
                entry_content_list = []
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
                enclosures_list = []
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
                        f"Article is paywalled. Attempting to fetch full HTML body with cookies."
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
                        "Article is not paywalled. Sending URL-only request to Instapaper."
                    )

                # Check if we have content to send to Instapaper
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
                        f"Found new entry: '{title}' from {entry_timestamp_dt.isoformat()}"
                    )
                else:
                    logging.warning(
                        f"Skipping entry '{title}' as no content could be retrieved and it's marked as paywalled."
                    )

        logging.info(f"Found {len(new_entries)} new entries from this feed.")

    except requests.exceptions.RequestException as e:
        logging.error(f"Error fetching RSS feed: {e}")
        if "response" in locals():
            logging.debug(f"HTTP status code: {feed_response.status_code}")
            logging.debug(f"HTTP response body: {feed_response.text}")
        raise
    except Exception as e:
        logging.error(f"An unexpected error occurred while processing feed: {e}")
        raise

    return new_entries


def sync_instapaper_bookmarks(instapaper_config, app_creds, bookmarks_to_sync):
    """
    Syncs the local list of bookmarks with Instapaper using the 'have' parameter.
    Modifies the bookmarks_to_sync dictionary in place.
    """
    logging.info(
        f"Starting Instapaper bookmark sync for {len(bookmarks_to_sync)} bookmarks."
    )

    try:
        oauth = OAuth1Session(
            app_creds.get("consumer_key"),
            client_secret=app_creds.get("consumer_secret"),
            resource_owner_key=instapaper_config.get("oauth_token"),
            resource_owner_secret=instapaper_config.get("oauth_token_secret"),
        )

        # Prepare the 'have' parameter as a comma-separated string of bookmark IDs
        bookmark_ids_string = ",".join(bookmarks_to_sync.keys())

        # Check if the string is not empty before adding to the payload
        if bookmark_ids_string:
            payload = {"have": bookmark_ids_string}
        else:
            payload = {}

        logging.debug(f"Payload to be sent: {payload}")

        response = oauth.post(INSTAPAPER_BOOKMARKS_LIST_URL, data=payload)
        response.raise_for_status()

        logging.debug(f"Raw response text from Instapaper: {response.text}")

        api_response = response.json()

        deleted_count = 0

        # NEW LOGIC: Access 'delete_ids' directly from the main JSON object.
        deleted_ids = api_response.get("delete_ids", [])
        logging.debug(f"Parsed 'delete_ids': {deleted_ids}")

        for deleted_id in deleted_ids:
            # Convert the integer ID to a string to match local dictionary keys
            deleted_id_str = str(deleted_id)
            if deleted_id_str in bookmarks_to_sync:
                del bookmarks_to_sync[deleted_id_str]
                logging.info(
                    f"Found deleted bookmark. Removing from local state. Bookmark ID: {deleted_id_str}"
                )
                deleted_count += 1
            else:
                logging.debug(
                    f"Bookmark ID {deleted_id_str} from Instapaper delete list not found in local state. Skipping."
                )

        logging.info(
            f"Sync complete. {deleted_count} bookmarks removed from local state."
        )

    except Exception as e:
        logging.error(f"Error during Instapaper bookmark sync: {e}")
        if "response" in locals():
            logging.debug(f"Instapaper API Response Text: {response.text}")


def apply_retention_policy(
    instapaper_ini_config, instapaper_config, app_creds, bookmarks_to_sync
):
    """
    Deletes bookmarks from Instapaper that have exceeded the defined retention period.
    Modifies the bookmarks_to_sync dictionary in place.
    """
    retention_str = instapaper_ini_config.get("retention", "")
    if not retention_str:
        logging.info("No retention policy configured. Skipping.")
        return

    try:
        retention_seconds = parse_frequency_to_seconds(retention_str)
    except ValueError as e:
        logging.error(f"Invalid retention value: {e}. Skipping retention policy.")
        return

    logging.info(f"Applying retention policy for bookmarks older than {retention_str}.")

    current_time = datetime.now(timezone.utc)
    bookmarks_to_delete_ids = []

    for bookmark_id, bookmark_data in list(bookmarks_to_sync.items()):
        try:
            publish_time_str = bookmark_data.get("published_timestamp")
            if not publish_time_str:
                logging.warning(
                    f"Bookmark ID {bookmark_id} has no publish timestamp. Skipping retention check."
                )
                continue

            publish_time = datetime.fromisoformat(publish_time_str)

            # Make sure the publish time is timezone-aware
            if (
                publish_time.tzinfo is None
                or publish_time.tzinfo.utcoffset(publish_time) is None
            ):
                publish_time = publish_time.replace(tzinfo=timezone.utc)

            if (current_time - publish_time).total_seconds() > retention_seconds:
                bookmarks_to_delete_ids.append(bookmark_id)
                logging.info(
                    f"Bookmark ID {bookmark_id} is older than the retention policy. Marked for deletion."
                )

        except ValueError as e:
            logging.warning(
                f"Error parsing timestamp for bookmark ID {bookmark_id}: {e}. Skipping."
            )
            continue

    if not bookmarks_to_delete_ids:
        logging.info("No bookmarks found that have exceeded the retention period.")
        return

    logging.info(f"Deleting {len(bookmarks_to_delete_ids)} bookmarks from Instapaper.")
    deleted_count = 0

    try:
        oauth = OAuth1Session(
            app_creds.get("consumer_key"),
            client_secret=app_creds.get("consumer_secret"),
            resource_owner_key=instapaper_config.get("oauth_token"),
            resource_owner_secret=instapaper_config.get("oauth_token_secret"),
        )

        for bookmark_id in bookmarks_to_delete_ids:
            try:
                payload = {"bookmark_id": bookmark_id}
                response = oauth.post(INSTAPAPER_BOOKMARKS_DELETE_URL, data=payload)
                response.raise_for_status()

                del bookmarks_to_sync[bookmark_id]
                logging.info(
                    f"Successfully deleted bookmark {bookmark_id} from Instapaper and local state."
                )
                deleted_count += 1

            except requests.exceptions.RequestException as e:
                logging.error(
                    f"Failed to delete bookmark {bookmark_id}: {e}. Will not remove from local state."
                )
                if "response" in locals():
                    logging.debug(f"Instapaper API Response Text: {response.text}")

    except Exception as e:
        logging.error(f"An error occurred during Instapaper API communication: {e}.")

    logging.info(
        f"Retention policy applied. {deleted_count} bookmarks deleted from Instapaper and local state."
    )


def get_config_files(path):
    """Parses the command-line argument to return a list of INI files."""
    if os.path.isfile(path) and path.endswith(".ini"):
        return [path]
    elif os.path.isdir(path):
        return glob(os.path.join(path, "*.ini"))
    else:
        logging.error(
            "Invalid path provided. Please specify a .ini file or a directory containing .ini files."
        )
        sys.exit(1)


_TEMPLATE_PATTERN = re.compile(r"{{\s*([a-zA-Z0-9_.-]+)\s*}}")


def _render_template(value, context):
    if isinstance(value, str):
        def _replace(match):
            key = match.group(1)
            return str(context.get(key, match.group(0)))

        return _TEMPLATE_PATTERN.sub(_replace, value)
    if isinstance(value, dict):
        return {k: _render_template(v, context) for k, v in value.items()}
    if isinstance(value, list):
        return [_render_template(v, context) for v in value]
    return value


def _serialize_requests_cookie(cookie):
    payload = {"name": cookie.name, "value": cookie.value}
    if cookie.domain:
        payload["domain"] = cookie.domain
    if cookie.path:
        payload["path"] = cookie.path
    if cookie.expires is not None:
        payload["expiry"] = cookie.expires
    if cookie.secure:
        payload["secure"] = True
    httponly = cookie._rest.get("HttpOnly") or cookie._rest.get("httponly")
    if httponly:
        payload["httpOnly"] = True
    return payload


def _extract_json_pointer(document, pointer):
    if document is None or not pointer:
        return None
    current = document
    parts = [part for part in pointer.split(".") if part]
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list):
            try:
                idx = int(part)
            except ValueError:
                return None
            if idx < 0 or idx >= len(current):
                return None
            current = current[idx]
        else:
            return None
        if current is None:
            return None
    return current


def _execute_api_step(session, step_config, context, config_name, step_name):
    endpoint = step_config.get("endpoint")
    method = (step_config.get("method") or "GET").upper()
    headers = step_config.get("headers") or {}
    body = step_config.get("body")

    if not endpoint:
        logging.error(
            f"API step '{step_name}' for {config_name} is missing an endpoint."
        )
        return None

    rendered_headers = _render_template(headers, context) if headers else {}
    rendered_body = _render_template(body, context) if body is not None else None

    request_kwargs: Dict[str, Any] = {}
    if rendered_headers:
        request_kwargs["headers"] = rendered_headers

    def _header_value(name: str) -> Optional[str]:
        lookup = name.lower()
        if not rendered_headers:
            return None
        for key, value in rendered_headers.items():
            if isinstance(key, str) and key.lower() == lookup:
                return value
        return None

    content_type = None
    header_value = _header_value("content-type")
    if isinstance(header_value, str):
        content_type = header_value.lower()

    def _use_form_payload() -> bool:
        if method in ("GET", "DELETE"):
            return False
        if not content_type:
            return False
        return "application/x-www-form-urlencoded" in content_type

    if rendered_body is not None:
        if method in ("GET", "DELETE"):
            if isinstance(rendered_body, dict):
                request_kwargs["params"] = rendered_body
            else:
                request_kwargs["data"] = rendered_body
        else:
            if isinstance(rendered_body, (dict, list)):
                if _use_form_payload():
                    request_kwargs["data"] = rendered_body
                else:
                    request_kwargs["json"] = rendered_body
            else:
                request_kwargs["data"] = rendered_body

    logging.info(
        f"Performing API {step_name} step for {config_name}: {method} {endpoint}"
    )

    try:
        response = session.request(method, endpoint, **request_kwargs)
    except requests.RequestException as exc:
        logging.error(
            f"API {step_name} request failed for {config_name} ({method} {endpoint}): {exc}"
        )
        return None

    return response


def _login_with_api(config_name, site_config, login_credentials):
    api_config = dict(site_config.get("api_config") or {})
    if not api_config:
        message = f"Missing api_config for {config_name}."
        logging.error(message)
        return {"cookies": [], "login_type": "api", "error": message}

    endpoint = api_config.get("endpoint")
    method = api_config.get("method")
    if not endpoint or not method:
        message = (
            f"API login for {config_name} requires both 'endpoint' and 'method'."
        )
        logging.error(message)
        return {"cookies": [], "login_type": "api", "error": message}

    cookies_to_store = list(api_config.get("cookies_to_store") or [])
    cookie_map = api_config.get("cookies") or {}
    if not cookies_to_store and cookie_map:
        cookies_to_store = list(cookie_map.keys())
    required_cookie_names = list(site_config.get("required_cookies") or [])
    if not required_cookie_names:
        required_cookie_names = list(cookies_to_store)

    context = dict(login_credentials or {})
    context.setdefault("username", (login_credentials or {}).get("username"))
    context.setdefault("password", (login_credentials or {}).get("password"))
    context.setdefault("config_name", config_name)
    context.setdefault("site_url", site_config.get("site_url"))

    session = requests.Session()
    details = {"endpoint": endpoint, "method": method}
    try:
        pre_login_steps = api_config.get("pre_login") or []
        if isinstance(pre_login_steps, dict):
            pre_login_steps = [pre_login_steps]
        if pre_login_steps:
            logging.info(f"Executing {len(pre_login_steps)} pre-login API steps for {config_name}.")
        for idx, step in enumerate(pre_login_steps):
            if not isinstance(step, dict):
                continue
            response = _execute_api_step(
                session,
                {
                    "endpoint": step.get("endpoint"),
                    "method": step.get("method"),
                    "headers": step.get("headers"),
                    "body": step.get("body"),
                },
                context,
                config_name,
                f"pre_login[{idx}]",
            )
            if response is None:
                message = f"Pre-login step {idx} failed for {config_name}."
                return {"cookies": [], "login_type": "api", "error": message}
            if response.status_code >= 400:
                message = (
                    f"Pre-login step {idx} returned status {response.status_code} for {config_name}."
                )
                logging.error(message)
                return {"cookies": [], "login_type": "api", "error": message}

        response = _execute_api_step(
            session,
            {
                "endpoint": endpoint,
                "method": method,
                "headers": api_config.get("headers"),
                "body": api_config.get("body"),
            },
            context,
            config_name,
            "login",
        )
        if response is None:
            message = f"API login request failed for {config_name}."
            return {"cookies": [], "login_type": "api", "error": message}
        details["status_code"] = response.status_code
        if response.status_code >= 400:
            message = (
                f"API login returned status {response.status_code} for {config_name}."
            )
            logging.error(message)
            return {"cookies": [], "login_type": "api", "error": message}

        jar_cookies = {cookie.name: cookie for cookie in session.cookies}
        serialized: Dict[str, Dict[str, Any]] = {}

        if cookies_to_store:
            for name in cookies_to_store:
                cookie_obj = jar_cookies.get(name)
                if cookie_obj:
                    serialized[name] = _serialize_requests_cookie(cookie_obj)
        else:
            for cookie_obj in session.cookies:
                serialized[cookie_obj.name] = _serialize_requests_cookie(cookie_obj)

        if cookie_map:
            body_json = None
            try:
                body_json = response.json()
            except ValueError:
                logging.debug(
                    f"API login for {config_name} did not return JSON body for cookie extraction."
                )
            for cookie_name, source in cookie_map.items():
                value = None
                if isinstance(source, str):
                    if source.startswith("$."):
                        value = _extract_json_pointer(body_json, source[2:])
                    else:
                        cookie_obj = jar_cookies.get(source)
                        if cookie_obj:
                            value = cookie_obj.value
                if value is not None:
                    serialized[cookie_name] = {"name": cookie_name, "value": value}

        cookies = list(serialized.values())
        if not cookies:
            message = (
                f"No cookies captured from API login for {config_name}. Check 'cookies_to_store' settings."
            )
            logging.error(message)
            return {"cookies": [], "login_type": "api", "error": message}

        if required_cookie_names:
            available_names = {cookie["name"] for cookie in cookies}
            missing_required = [
                name for name in required_cookie_names if name not in available_names
            ]
            if missing_required:
                message = (
                    f"Missing required cookies after API login for {config_name}: {', '.join(missing_required)}."
                )
                logging.error(message)
                return {"cookies": [], "login_type": "api", "error": message}

        logging.info(
            f"API login succeeded for {config_name}; captured {len(cookies)} cookies."
        )
        details["captured_cookies"] = [cookie["name"] for cookie in cookies]
        details["required_cookies"] = required_cookie_names
        details["cookies_to_store"] = cookies_to_store
        return {"cookies": cookies, "login_type": "api", "details": details}
    finally:
        session.close()


def _verify_success_text(wait, success_text_class, expected_success_text, config_name):
    """Validate that the configured success text appears on the page."""

    class_name = (success_text_class or "").strip()
    expected_text = (expected_success_text or "").strip()
    if not class_name or not expected_text:
        return True

    class_tokens = [token for token in class_name.split(" ") if token]
    if not class_tokens:
        logging.warning(
            f"Success text class configured for {config_name} is empty after stripping."
        )
        return False

    selector = "." + ".".join(class_tokens)
    try:
        element = wait.until(
            EC.presence_of_element_located((By.CSS_SELECTOR, selector))
        )
    except TimeoutException:
        logging.error(
            f"Login failed for {config_name}. Success text element '{selector}' not found."
        )
        return False

    actual_text = (element.text or "").strip()
    if expected_text not in actual_text:
        logging.error(
            f"Login failed for {config_name}. Expected success text '{expected_text}' not found within '{actual_text}'."
        )
        return False

    logging.info(
        f"Login success text verified for {config_name} using selector '{selector}'."
    )
    return True


def _login_with_selenium(config_name, site_config, login_credentials):
    driver = None
    try:
        if not login_credentials or not site_config:
            message = (
                f"Missing login credentials or site configuration for {config_name}. Skipping login."
            )
            logging.error(message)
            return {"cookies": [], "login_type": "selenium", "error": message}

        username = login_credentials.get("username")
        password = login_credentials.get("password")
        selenium_config = site_config.get("selenium_config") or {}
        if not selenium_config and site_config.get("username_selector"):
            selenium_config = {
                "username_selector": site_config.get("username_selector"),
                "password_selector": site_config.get("password_selector"),
                "login_button_selector": site_config.get("login_button_selector"),
                "post_login_selector": site_config.get("post_login_selector"),
                "cookies_to_store": site_config.get("cookies_to_store", []),
            }
        site_url = site_config.get("site_url")
        username_selector = selenium_config.get("username_selector")
        password_selector = selenium_config.get("password_selector")
        login_button_selector = selenium_config.get("login_button_selector")
        cookies_to_store_names = selenium_config.get("cookies_to_store", [])
        required_cookie_names = list(site_config.get("required_cookies") or [])
        if not required_cookie_names:
            required_cookie_names = list(cookies_to_store_names)

        if not all(
            [
                username,
                password,
                site_url,
                username_selector,
                password_selector,
                login_button_selector,
                cookies_to_store_names,
            ]
        ):
            message = f"Incomplete login configuration for {config_name}. Skipping login."
            logging.error(message)
            return {"cookies": [], "login_type": "selenium", "error": message}

        logging.info(f"Starting Selenium for {config_name} to perform login...")

        driver = webdriver.Chrome(service=service, options=options)
        driver.get(site_url)

        wait = WebDriverWait(driver, 30)
        username_field = wait.until(
            EC.presence_of_element_located((By.CSS_SELECTOR, username_selector))
        )
        username_field.send_keys(username)

        password_field = driver.find_element(By.CSS_SELECTOR, password_selector)
        password_field.send_keys(password)

        login_button = driver.find_element(By.CSS_SELECTOR, login_button_selector)
        login_button.click()

        logging.info("Login form submitted. Waiting for page to load...")

        try:
            wait.until(EC.url_changes(site_url))
            logging.info(f"Login successful for {config_name} (URL changed).")
        except TimeoutException:
            logging.warning(
                f"Login URL did not change for {config_name}. Checking for post-login element..."
            )
            post_login_selector = selenium_config.get("post_login_selector")
            if post_login_selector:
                try:
                    wait.until(
                        EC.presence_of_element_located(
                            (By.CSS_SELECTOR, post_login_selector)
                        )
                    )
                    logging.info(
                        f"Login successful for {config_name} (found post-login element)."
                    )
                except TimeoutException:
                    message = (
                        f"Login failed for {config_name}. Post-login element not found."
                    )
                    logging.error(message)
                    return {"cookies": [], "login_type": "selenium", "error": message}
            else:
                message = (
                    f"Login failed for {config_name}. Neither URL change nor post-login selector succeeded."
                )
                logging.error(message)
                return {"cookies": [], "login_type": "selenium", "error": message}

        success_text_class = site_config.get("success_text_class")
        expected_success_text = site_config.get("expected_success_text")
        if not _verify_success_text(
            wait, success_text_class, expected_success_text, config_name
        ):
            return {
                "cookies": [],
                "login_type": "selenium",
                "error": (
                    f"Success text verification failed for {config_name}."
                ),
            }

        if ENABLE_SCREENSHOTS:
            screenshot_path = os.path.join(
                log_dir,
                f"login_success_{config_name}_{datetime.now().strftime('%Y%m%d%H%M%S')}.png",
            )
            driver.save_screenshot(screenshot_path)
            logging.info(f"Screenshot saved to {screenshot_path}.")

        cookies = driver.get_cookies()
        missing_required = []
        if required_cookie_names:
            available_names = {cookie.get("name") for cookie in cookies}
            missing_required = [
                name for name in required_cookie_names if name not in available_names
            ]
        if missing_required:
            message = (
                f"Missing required cookies after login for {config_name}: {', '.join(missing_required)}."
            )
            logging.error(message)
            return {"cookies": [], "login_type": "selenium", "error": message}

        filtered_cookies = [c for c in cookies if c["name"] in cookies_to_store_names]
        if cookies_to_store_names and not filtered_cookies:
            message = (
                f"No required cookies found after login for {config_name}. Check 'cookies_to_store' configuration."
            )
            logging.error(message)
            return {"cookies": [], "login_type": "selenium", "error": message}

        return {
            "cookies": filtered_cookies,
            "login_type": "selenium",
            "details": {
                "cookies_to_store": cookies_to_store_names,
                "required_cookies": required_cookie_names,
            },
        }

    except WebDriverException as e:
        message = f"Selenium WebDriver error during login for {config_name}: {e}"
        logging.error(message)
        return {"cookies": [], "login_type": "selenium", "error": message}
    except Exception as e:
        message = f"An unexpected error occurred during login for {config_name}: {e}"
        logging.error(message)
        return {"cookies": [], "login_type": "selenium", "error": message}
    finally:
        if driver:
            driver.quit()
            logging.info("Selenium driver quit.")


def login_and_update(config_name, site_config, login_credentials):
    """Perform login using the configured strategy and return captured cookies."""

    login_type = (site_config or {}).get("login_type", "selenium").lower()
    logging.info(f"login_and_update dispatcher selected '{login_type}' for {config_name}.")

    if login_type == "selenium":
        return _login_with_selenium(config_name, site_config, login_credentials)
    if login_type == "api":
        return _login_with_api(config_name, site_config, login_credentials)

    message = f"Unsupported login type '{login_type}' for {config_name}."
    logging.error(message)
    return {"cookies": [], "login_type": login_type, "error": message}


def run_service(
    config_path, all_configs, all_site_configs, instapaper_app_creds, all_cookie_state
):
    """The main service loop that processes configs continuously."""
    config_files = get_config_files(config_path)

    while True:
        logging.info("Starting a new service poll loop")

        all_new_entries = []

        for config_file in config_files:
            config = configparser.ConfigParser()
            try:
                config.read(config_file)
                config_name = os.path.basename(config_file)

                state = load_state(config_file)
                current_time = datetime.now(timezone.utc)

                if "CONFIG_REFERENCES" not in config:
                    logging.warning(
                        f"Missing [CONFIG_REFERENCES] section in {config_name}. Skipping this config."
                    )
                    continue
                ref_config = config["CONFIG_REFERENCES"]

                login_id = ref_config.get("login_id")
                site_config_id = ref_config.get("site_config_id")
                instapaper_id = ref_config.get("instapaper_id")
                miniflux_id = ref_config.get("miniflux_id")

                cookie_key = f"{login_id}-{site_config_id}"

                login_credentials = all_configs.get(login_id)
                site_config = normalize_site_config_payload(
                    all_site_configs.get(site_config_id)
                )
                instapaper_config_from_json = all_configs.get(instapaper_id)
                miniflux_config_from_json = all_configs.get(miniflux_id)

                instapaper_ini_config = (
                    config["INSTAPAPER_CONFIG"] if "INSTAPAPER_CONFIG" in config else {}
                )
                rss_feed_config = (
                    config["RSS_FEED_CONFIG"] if "RSS_FEED_CONFIG" in config else {}
                )
                miniflux_ini_config = (
                    config["MINIFLUX_CONFIG"] if "MINIFLUX_CONFIG" in config else {}
                )

                # --- New Validation Check for Configuration Mismatch ---
                is_paywalled = (
                    rss_feed_config.getboolean("is_paywalled", fallback=False)
                    if rss_feed_config
                    else False
                )
                rss_requires_auth = (
                    rss_feed_config.getboolean("rss_requires_auth", fallback=False)
                    if rss_feed_config
                    else False
                )

                if (is_paywalled or rss_requires_auth) and (
                    not login_id or not site_config_id
                ):
                    logging.warning(
                        f"Configuration mismatch in '{config_name}': 'is_paywalled' or 'rss_requires_auth' is set to true, but "
                        f"the required 'login_id' and/or 'site_config_id' are missing in "
                        f"[CONFIG_REFERENCES]. This will likely cause the script to fail to fetch "
                        f"content."
                    )
                # --- End of Validation Check ---

                # --- Login and Cookie Management ---
                cookies = []

                # Check if a login is configured for this INI file
                if login_credentials and site_config:
                    cached_cookies_data = all_cookie_state.get(cookie_key, {})
                    cached_cookies = cached_cookies_data.get("cookies", [])
                    selenium_cfg = (site_config or {}).get("selenium_config") or {}
                    cookies_to_store_names = (
                        selenium_cfg.get("cookies_to_store", []) if site_config else []
                    )
                    required_cookie_names = (
                        site_config.get("required_cookies") or cookies_to_store_names
                    )
                    cookies_expired = check_cookies_expiry(
                        cached_cookies, required_cookie_names
                    )

                    required_cookie_missing = False
                    if required_cookie_names:
                        cached_cookie_names = {c["name"] for c in cached_cookies}
                        if not all(
                            name in cached_cookie_names
                            for name in required_cookie_names
                        ):
                            required_cookie_missing = True

                    imminent_expiry = False
                    miniflux_refresh_frequency_sec = 0
                    if miniflux_ini_config and miniflux_ini_config.get(
                        "refresh_frequency"
                    ):
                        miniflux_refresh_frequency_sec = parse_frequency_to_seconds(
                            miniflux_ini_config.get("refresh_frequency")
                        )
                    rss_poll_frequency_sec = 0
                    if rss_feed_config:
                        poll_frequency_str = rss_feed_config.get("poll_frequency")
                        if not poll_frequency_str:
                            poll_frequency_str = "1h"  # Default value
                        rss_poll_frequency_sec = parse_frequency_to_seconds(
                            poll_frequency_str
                        )

                    if cached_cookies and required_cookie_names:
                        min_expiry_timestamp = float("inf")
                        required_cookies_with_expiry = [
                            c
                            for c in cached_cookies
                            if c.get("name") in required_cookie_names
                            and c.get("expiry")
                        ]
                        if required_cookies_with_expiry:
                            min_expiry_timestamp = min(
                                c["expiry"] for c in required_cookies_with_expiry
                            )

                        next_miniflux_refresh_time = state[
                            "last_miniflux_refresh_time"
                        ] + timedelta(seconds=miniflux_refresh_frequency_sec)
                        next_rss_poll_time = state["last_rss_poll_time"] + timedelta(
                            seconds=rss_poll_frequency_sec
                        )

                        if (
                            min_expiry_timestamp
                            <= next_miniflux_refresh_time.timestamp()
                            or min_expiry_timestamp <= next_rss_poll_time.timestamp()
                        ):
                            imminent_expiry = True

                    # The logic to decide if a login should be performed
                    should_perform_login = (
                        not cached_cookies
                        or cookies_expired
                        or required_cookie_missing
                        or imminent_expiry
                        or state.get(
                            "force_run", False
                        )  # This flag allows an external override
                    )

                    if should_perform_login:
                        reasons = []
                        if not cached_cookies:
                            reasons.append("No cached cookies found")
                        if cookies_expired:
                            reasons.append("Cookies expired")
                        if required_cookie_missing:
                            reasons.append("Required cookie missing")
                        if imminent_expiry:
                            reasons.append("Imminent expiry")
                        if state.get("force_run", False):
                            reasons.append("Force Run flag set")
                        logging.info(
                            f"Triggering login for {config_name}. Reasons: {', '.join(reasons)}"
                        )

                        login_result = login_and_update(
                            config_name, site_config, login_credentials
                        )

                        cookies = []
                        if isinstance(login_result, dict):
                            cookies = login_result.get("cookies") or []
                            if not cookies and login_result.get("error"):
                                logging.error(
                                    f"Login failed for {config_name}: {login_result.get('error')}"
                                )
                        else:
                            logging.error(
                                f"Login handler returned unexpected payload for {config_name}."
                            )

                        if cookies:
                            # If a login was successful, update Miniflux immediately
                            if (
                                miniflux_config_from_json
                                and miniflux_ini_config
                                and miniflux_ini_config.get("feed_ids")
                            ):
                                logging.info(
                                    f"Login successful. Immediately updating Miniflux feeds with new cookies."
                                )
                                update_miniflux_feed_with_cookies(
                                    miniflux_config_from_json,
                                    cookies,
                                    config_name,
                                    miniflux_ini_config.get("feed_ids"),
                                )
                                # Update last refresh time after a successful Miniflux update
                                state["last_miniflux_refresh_time"] = current_time

                            all_cookie_state[cookie_key] = {
                                "cookies": cookies,
                                "last_refresh": current_time.isoformat(),
                            }
                            save_cookies_to_json(
                                os.path.dirname(config_file), all_cookie_state
                            )
                            # Update state timestamps after a successful login
                            state["last_rss_poll_time"] = current_time
                        else:
                            logging.warning(
                                f"Login failed for {config_name}. Cannot update state with new cookies."
                            )

                        state["force_run"] = False
                        save_state(config_file, state)
                    else:
                        cookies = cached_cookies
                        logging.info(
                            f"Using cached cookies for {config_name}. Login was not required."
                        )
                else:
                    logging.warning(
                        f"Bypassing login and cookie caching for {config_name}. Missing login credentials or site configuration."
                    )
                    cookies = []

                # --- Scheduled Actions (Miniflux and RSS) ---
                miniflux_refresh_due = False
                rss_poll_due = False

                # Check due times based on the state file
                miniflux_refresh_frequency_sec = 0
                if miniflux_ini_config and miniflux_ini_config.get("refresh_frequency"):
                    miniflux_refresh_frequency_sec = parse_frequency_to_seconds(
                        miniflux_ini_config.get("refresh_frequency")
                    )
                    if (
                        current_time - state["last_miniflux_refresh_time"]
                    ).total_seconds() >= miniflux_refresh_frequency_sec:
                        miniflux_refresh_due = True
                    else:
                        logging.info(f"Miniflux refresh for {config_name} not yet due.")

                rss_poll_frequency_sec = 0
                if rss_feed_config:
                    poll_frequency_str = rss_feed_config.get("poll_frequency")
                    if not poll_frequency_str:
                        poll_frequency_str = "1h"  # Default value
                        logging.info(
                            "RSS poll frequency not configured. Using default of 1h."
                        )

                    rss_poll_frequency_sec = parse_frequency_to_seconds(
                        poll_frequency_str
                    )

                    if (
                        current_time - state["last_rss_poll_time"]
                    ).total_seconds() >= rss_poll_frequency_sec:
                        rss_poll_due = True
                    else:
                        logging.info(f"RSS poll for {config_name} not yet due.")

                # Special case: If this is the first time running for a given INI file,
                # we force a poll to catch all initial entries.
                if state["last_rss_timestamp"] == datetime.fromtimestamp(
                    0, tz=timezone.utc
                ):
                    rss_poll_due = True
                    logging.info(
                        "First run detected for this INI's state file. All entries from RSS feed will be processed."
                    )

                # *** NEW LOGIC ADDED HERE ***
                # Check if Miniflux refresh is older than the last cookie update, and force a refresh if so.
                is_cookie_newer = False
                if login_credentials and site_config:
                    cached_cookies_data = all_cookie_state.get(cookie_key, {})
                    if cached_cookies_data.get("last_refresh"):
                        cookie_last_refresh_time = datetime.fromisoformat(
                            cached_cookies_data["last_refresh"]
                        )
                        if (
                            cookie_last_refresh_time
                            > state["last_miniflux_refresh_time"]
                        ):
                            is_cookie_newer = True

                # Miniflux Update Logic
                if miniflux_config_from_json and (
                    miniflux_refresh_due or is_cookie_newer
                ):
                    feed_ids_str = miniflux_ini_config.get("feed_ids")
                    if feed_ids_str:
                        if is_cookie_newer:
                            logging.info(
                                f"Forcing Miniflux update for {config_name} because a cookie update is newer than the last Miniflux refresh."
                            )
                        else:
                            logging.info(
                                f"Updating Miniflux feed(s) with most recent cookies for {config_name}."
                            )
                        update_miniflux_feed_with_cookies(
                            miniflux_config_from_json,
                            cookies,
                            config_name,
                            feed_ids_str,
                        )
                        state["last_miniflux_refresh_time"] = current_time
                        save_state(config_file, state)
                    else:
                        logging.warning(
                            f"Skipping Miniflux update for {config_name}: 'feed_ids' is missing from INI file."
                        )
                else:
                    if not miniflux_config_from_json:
                        logging.info(
                            f"Skipping Miniflux update for {config_name}: Configuration not found in credentials.json."
                        )
                    # (The 'not yet due' case is handled above)

                # RSS Polling Logic
                if instapaper_config_from_json and rss_feed_config and rss_poll_due:
                    feed_url = rss_feed_config.get("feed_url")
                    if feed_url:
                        logging.info("Starting RSS polling and state update sequence.")
                        logging.info(
                            f"Polling RSS feed for new entries ({config_name})"
                        )
                        new_entries = get_new_rss_entries(
                            config_file,
                            feed_url,
                            instapaper_config_from_json,
                            instapaper_app_creds,
                            rss_feed_config,
                            instapaper_ini_config,
                            cookies,
                            state,
                            site_config,
                        )
                        all_new_entries.extend(new_entries)
                        state["last_rss_poll_time"] = current_time
                        save_state(config_file, state)
                        logging.info("RSS polling and state update sequence finished.")
                    else:
                        logging.warning(
                            f"Skipping RSS to Instapaper for {config_name}: 'feed_url' is missing."
                        )
                else:
                    if not instapaper_config_from_json:
                        logging.info(
                            f"Skipping RSS poll for {config_name}: Instapaper configuration not found in credentials.json."
                        )
                    elif not rss_feed_config:
                        logging.info(
                            f"Skipping RSS poll for {config_name}: RSS feed configuration not found in INI file."
                        )
                    # (The 'not yet due' case is handled above, with the exception of the first run)

            except (configparser.Error, KeyError) as e:
                logging.error(f"Error reading or parsing INI file {config_file}: {e}")
                continue

        if all_new_entries:
            logging.info(
                "Found new entries across all feeds. Sorting and publishing chronologically."
            )
            all_new_entries.sort(key=lambda x: x["published_dt"])

            published_count = 0
            for entry in all_new_entries:
                instapaper_config_from_json = entry["instapaper_config"]
                app_creds = entry["app_creds"]
                instapaper_ini_config = entry["instapaper_ini_config"]
                site_config = entry["site_config"]
                config_file_for_entry = entry["config_file"]

                try:
                    resolve_final_url_flag = instapaper_ini_config.getboolean(
                        "resolve_final_url", fallback=True
                    )
                except ValueError as e:
                    logging.warning(
                        f"Invalid boolean value for Instapaper config: {e}. Defaulting to fallback values."
                    )
                    resolve_final_url_flag = True

                folder_name = instapaper_ini_config.get("folder", "")
                categories_for_tags = entry.get("categories_from_feed", [])

                folder_id = None
                if folder_name:
                    oauth_session = OAuth1Session(
                        app_creds.get("consumer_key"),
                        client_secret=app_creds.get("consumer_secret"),
                        resource_owner_key=instapaper_config_from_json.get(
                            "oauth_token"
                        ),
                        resource_owner_secret=instapaper_config_from_json.get(
                            "oauth_token_secret"
                        ),
                    )
                    folder_id = get_instapaper_folder_id(oauth_session, folder_name)
                    if not folder_id:
                        folder_id = create_instapaper_folder(oauth_session, folder_name)

                publish_result = publish_to_instapaper(
                    instapaper_config_from_json,
                    app_creds,
                    entry["url"],
                    entry["title"],
                    entry["raw_html_content"],
                    categories_from_feed=categories_for_tags,
                    instapaper_ini_config=instapaper_ini_config,
                    site_config=site_config,
                    resolve_final_url=resolve_final_url_flag,
                )

                if publish_result:
                    state_to_update = load_state(config_file_for_entry)

                    # Store the new bookmark information
                    bookmark_id = publish_result["bookmark_id"]
                    state_to_update["bookmarks"][bookmark_id] = {
                        "content_location": publish_result["content_location"],
                        "title": publish_result["title"],
                        "published_timestamp": datetime.now(timezone.utc).isoformat(),
                    }

                    # Update the last RSS entry timestamp
                    state_to_update["last_rss_timestamp"] = entry["published_dt"]
                    save_state(config_file_for_entry, state_to_update)

                published_count += 1

            logging.info(
                f"Finished publishing. Published {published_count} new entries to Instapaper."
            )

        # --- NEW CODE: Sync & Purge Check outside of the new entries block ---
        for config_file in config_files:
            config = configparser.ConfigParser()
            config.read(config_file)
            state_to_sync_purge = load_state(config_file)

            if "CONFIG_REFERENCES" not in config:
                continue

            instapaper_id = config["CONFIG_REFERENCES"].get("instapaper_id")
            if instapaper_id and state_to_sync_purge.get("force_sync_and_purge", False):
                logging.info(
                    f"Force sync and purge flag detected for {os.path.basename(config_file)}. Running sync and retention policy."
                )

                instapaper_config_from_json = all_configs.get(instapaper_id)
                instapaper_ini_config = (
                    config["INSTAPAPER_CONFIG"] if "INSTAPAPER_CONFIG" in config else {}
                )

                sync_instapaper_bookmarks(
                    instapaper_config_from_json,
                    instapaper_app_creds,
                    state_to_sync_purge["bookmarks"],
                )

                apply_retention_policy(
                    instapaper_ini_config,
                    instapaper_config_from_json,
                    instapaper_app_creds,
                    state_to_sync_purge["bookmarks"],
                )

                # Reset the flag after a successful run
                state_to_sync_purge["force_sync_and_purge"] = False
                save_state(config_file, state_to_sync_purge)
                logging.info(
                    f"Force sync and purge finished and flag has been reset for {os.path.basename(config_file)}."
                )
        # --- END NEW CODE ---

        logging.info("Service poll loop finished. Sleeping for 60 seconds.")
        time.sleep(60)


def main():
    """Main function to parse arguments and start the service loop."""
    parser = argparse.ArgumentParser(
        description="Run RSS to Instapaper bridge as a continuous service."
    )
    parser.add_argument(
        "config_path",
        help="Path to a specific .ini file or a directory containing .ini files.",
    )
    args = parser.parse_args()

    config_dir = (
        os.path.dirname(args.config_path)
        if os.path.isfile(args.config_path)
        else args.config_path
    )

    all_external_configs = load_credentials_from_json(config_dir)
    all_site_configs = load_site_configs_from_json(config_dir)
    instapaper_app_creds = load_instapaper_app_creds(config_dir)
    all_cookie_state = load_cookies_from_json(config_dir)

    logging.info("Checking for Instapaper credentials to migrate...")
    config_files = get_config_files(args.config_path)
    for config_file in config_files:
        config = configparser.ConfigParser()
        config.read(config_file)
        if (
            "CONFIG_REFERENCES" in config
            and "instapaper_id" in config["CONFIG_REFERENCES"]
        ):
            instapaper_id = config["CONFIG_REFERENCES"]["instapaper_id"]
            instapaper_config_data = all_external_configs.get(instapaper_id, {})

            if not instapaper_config_data.get(
                "oauth_token"
            ) or not instapaper_config_data.get("oauth_token_secret"):
                logging.info(
                    f"Instapaper tokens not found for '{instapaper_id}'. Checking for migration credentials."
                )

                if (
                    "INSTAPAPER_LOGIN" in config
                    and "email" in config["INSTAPAPER_LOGIN"]
                    and "password" in config["INSTAPAPER_LOGIN"]
                ):
                    username = config["INSTAPAPER_LOGIN"]["email"]
                    password = config["INSTAPAPER_LOGIN"]["password"]

                    if instapaper_app_creds:
                        token_result = get_instapaper_tokens(
                            instapaper_app_creds.get("consumer_key"),
                            instapaper_app_creds.get("consumer_secret"),
                            username,
                            password,
                        )

                        tokens = token_result.tokens() if token_result.success else None

                        if tokens:
                            all_external_configs[instapaper_id]["oauth_token"] = tokens[
                                "oauth_token"
                            ]
                            all_external_configs[instapaper_id][
                                "oauth_token_secret"
                            ] = tokens["oauth_token_secret"]
                            save_credentials_to_json(config_dir, all_external_configs)

                            config.remove_section("INSTAPAPER_LOGIN")
                            with open(config_file, "w") as f:
                                config.write(f)

                            logging.info(
                                f"Successfully migrated Instapaper credentials for '{os.path.basename(config_file)}' and cleaned up INI file."
                            )
                        else:
                            logging.error(
                                "Failed to generate Instapaper tokens for '%s'. "
                                "Please check INI credentials and consumer keys. Error: %s",
                                os.path.basename(config_file),
                                token_result.error,
                            )
                    else:
                        logging.error(
                            f"Instapaper application credentials not found. Cannot generate tokens."
                        )
                else:
                    logging.warning(
                        f"No Instapaper credentials (email/password) found in '{os.path.basename(config_file)}'. Cannot perform migration."
                    )

    logging.info("Starting the continuous service loop...")
    run_service(
        args.config_path,
        all_external_configs,
        all_site_configs,
        instapaper_app_creds,
        all_cookie_state,
    )


if __name__ == "__main__":
    main()
