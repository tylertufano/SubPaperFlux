"""SubPaperFlux login helpers extracted from the legacy CLI module."""

from __future__ import annotations

import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Optional

import requests
from selenium import webdriver
from selenium.common.exceptions import WebDriverException, TimeoutException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from webdriver_manager.chrome import ChromeDriverManager

__all__ = [
    "login_and_update",
    "_execute_api_step",
    "_render_template",
]


_DEBUG_LOGGING = os.getenv("DEBUG_LOGGING", "0").lower() in {"1", "true"}
_ENABLE_SCREENSHOTS = os.getenv("ENABLE_SCREENSHOTS", "0").lower() in {"1", "true"}
_SCREENSHOT_DIR = Path(os.getenv("SPF_SCREENSHOT_DIR", "selenium_logs"))
_DEFAULT_API_LOGIN_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/127.0.0.0 Safari/537.36"
)


_driver_path: Optional[str] = None


def _ensure_log_dir() -> None:
    if _ENABLE_SCREENSHOTS or _DEBUG_LOGGING:
        _SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)


def _get_chromedriver_path() -> str:
    global _driver_path
    if _driver_path:
        return _driver_path
    _ensure_log_dir()
    _driver_path = ChromeDriverManager().install()
    return _driver_path


def _build_chrome_options() -> Options:
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--window-size=1920,1080")
    options.add_argument(
        "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/533.36"
    )
    options.add_argument("--ignore-certificate-errors")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--no-proxy-server")
    options.add_argument("--disable-dev-shm-usage")
    if _DEBUG_LOGGING:
        options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    return options


def _build_chrome_service() -> Service:
    service_log_path = os.devnull
    if _DEBUG_LOGGING:
        _ensure_log_dir()
        service_log_path = str(_SCREENSHOT_DIR / "chromedriver.log")
    driver_path = _get_chromedriver_path()
    return Service(driver_path, log_output=service_log_path)


def _create_webdriver(
    driver_factory: Optional[Callable[[], webdriver.Chrome]] = None,
) -> webdriver.Chrome:
    if driver_factory is not None:
        return driver_factory()
    options = _build_chrome_options()
    service = _build_chrome_service()
    return webdriver.Chrome(service=service, options=options)


def _render_template(value: Any, context: Dict[str, Any]) -> Any:
    if isinstance(value, str):
        import re

        pattern = re.compile(r"{{\s*([a-zA-Z0-9_.-]+)\s*}}")

        def _replace(match: "re.Match[str]") -> str:
            key = match.group(1)
            return str(context.get(key, match.group(0)))

        return pattern.sub(_replace, value)
    if isinstance(value, dict):
        return {k: _render_template(v, context) for k, v in value.items()}
    if isinstance(value, list):
        return [_render_template(v, context) for v in value]
    return value


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


def _extract_json_pointer(document: Any, pointer: str) -> Any:
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


def _execute_api_step(
    session: requests.Session,
    step_config: Dict[str, Any],
    context: Dict[str, Any],
    config_name: str,
    step_name: str,
) -> Optional[requests.Response]:
    endpoint = step_config.get("endpoint")
    method = (step_config.get("method") or "GET").upper()
    headers = step_config.get("headers")
    body = step_config.get("body")

    if not endpoint:
        logging.error(
            "API step '%s' for %s is missing an endpoint.",
            step_name,
            config_name,
        )
        return None

    rendered_headers = _render_template(headers, context) if headers else {}
    rendered_body = _render_template(body, context) if body is not None else None

    request_kwargs: Dict[str, Any] = {}
    if rendered_headers:
        request_kwargs["headers"] = rendered_headers

    def _header_value(name: str) -> Optional[str]:
        if not rendered_headers:
            return None
        lookup = name.lower()
        for key, value in rendered_headers.items():
            if isinstance(key, str) and key.lower() == lookup:
                return value
        return None

    content_type = None
    header_value = _header_value("content-type")
    if isinstance(header_value, str):
        content_type = header_value.lower()

    def _use_form_payload() -> bool:
        if method in {"GET", "DELETE"}:
            return False
        if not content_type:
            return False
        return "application/x-www-form-urlencoded" in content_type

    if rendered_body is not None:
        if method in {"GET", "DELETE"}:
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
        "Performing API %s step for %s: %s %s",
        step_name,
        config_name,
        method,
        endpoint,
    )

    try:
        response = session.request(method, endpoint, **request_kwargs)
    except requests.RequestException as exc:
        logging.error(
            "API %s request failed for %s (%s %s): %s",
            step_name,
            config_name,
            method,
            endpoint,
            exc,
        )
        return None

    return response


def _login_with_api(
    config_name: str,
    site_config: Dict[str, Any],
    login_credentials: Dict[str, Any],
) -> Dict[str, Any]:
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
    session.headers.setdefault("User-Agent", _DEFAULT_API_LOGIN_USER_AGENT)
    details = {"endpoint": endpoint, "method": method}
    try:
        pre_login_steps = api_config.get("pre_login") or []
        if isinstance(pre_login_steps, dict):
            pre_login_steps = [pre_login_steps]
        if pre_login_steps:
            logging.info(
                "Executing %s pre-login API steps for %s.",
                len(pre_login_steps),
                config_name,
            )
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
                    f"API pre-login step returned status {response.status_code} for {config_name}."
                )
                logging.error(message)
                return {"cookies": [], "login_type": "api", "error": message}

        login_response = _execute_api_step(
            session,
            {
                "endpoint": api_config.get("endpoint"),
                "method": api_config.get("method"),
                "headers": api_config.get("headers"),
                "body": api_config.get("body"),
            },
            context,
            config_name,
            "login",
        )
        if login_response is None:
            message = f"API login request failed for {config_name}."
            return {"cookies": [], "login_type": "api", "error": message}
        details["status_code"] = login_response.status_code
        if login_response.status_code >= 400:
            message = (
                f"API login returned status {login_response.status_code} for {config_name}."
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
                body_json = login_response.json()
            except ValueError:
                logging.debug(
                    "API login for %s did not return JSON body for cookie extraction.",
                    config_name,
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
            "API login succeeded for %s; captured %s cookies.",
            config_name,
            len(cookies),
        )
        details["captured_cookies"] = [cookie["name"] for cookie in cookies]
        details["required_cookies"] = required_cookie_names
        details["cookies_to_store"] = cookies_to_store
        return {"cookies": cookies, "login_type": "api", "details": details}
    finally:
        session.close()


def _verify_success_text(
    wait: WebDriverWait,
    success_text_class: Optional[str],
    expected_success_text: Optional[str],
    config_name: str,
) -> bool:
    class_name = (success_text_class or "").strip()
    expected_text = (expected_success_text or "").strip()
    if not class_name or not expected_text:
        return True

    class_tokens = [token for token in class_name.split(" ") if token]
    if not class_tokens:
        logging.warning(
            "Success text class configured for %s is empty after stripping.",
            config_name,
        )
        return False

    selector = "." + ".".join(class_tokens)
    try:
        element = wait.until(
            EC.presence_of_element_located((By.CSS_SELECTOR, selector))
        )
    except TimeoutException:
        logging.error(
            "Login failed for %s. Success text element '%s' not found.",
            config_name,
            selector,
        )
        return False

    actual_text = (element.text or "").strip()
    if expected_text not in actual_text:
        logging.error(
            "Login failed for %s. Expected success text '%s' not found within '%s'.",
            config_name,
            expected_text,
            actual_text,
        )
        return False

    logging.info(
        "Login success text verified for %s using selector '%s'.",
        config_name,
        selector,
    )
    return True


def _login_with_selenium(
    config_name: str,
    site_config: Dict[str, Any],
    login_credentials: Dict[str, Any],
    *,
    driver_factory: Optional[Callable[[], webdriver.Chrome]] = None,
) -> Dict[str, Any]:
    driver: Optional[webdriver.Chrome] = None
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

        logging.info("Starting Selenium for %s to perform login...", config_name)

        driver = _create_webdriver(driver_factory)
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
            logging.info("Login successful for %s (URL changed).", config_name)
        except TimeoutException:
            logging.warning(
                "Login URL did not change for %s. Checking for post-login element...",
                config_name,
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
                        "Login successful for %s (found post-login element).",
                        config_name,
                    )
                except TimeoutException:
                    message = (
                        f"Login failed for {config_name}. Post-login element not found."
                    )
                    logging.error(message)
                    return {
                        "cookies": [],
                        "login_type": "selenium",
                        "error": message,
                    }
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

        if _ENABLE_SCREENSHOTS:
            _ensure_log_dir()
            screenshot_path = _SCREENSHOT_DIR / (
                f"login_success_{config_name}_{datetime.now().strftime('%Y%m%d%H%M%S')}.png"
            )
            driver.save_screenshot(str(screenshot_path))
            logging.info("Screenshot saved to %s.", screenshot_path)

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

    except WebDriverException as exc:
        message = f"Selenium WebDriver error during login for {config_name}: {exc}"
        logging.error(message)
        return {"cookies": [], "login_type": "selenium", "error": message}
    except Exception as exc:  # noqa: BLE001
        message = f"An unexpected error occurred during login for {config_name}: {exc}"
        logging.error(message)
        return {"cookies": [], "login_type": "selenium", "error": message}
    finally:
        if driver:
            driver.quit()
            logging.info("Selenium driver quit.")


def login_and_update(
    config_name: str,
    site_config: Dict[str, Any],
    login_credentials: Dict[str, Any],
    *,
    driver_factory: Optional[Callable[[], webdriver.Chrome]] = None,
) -> Dict[str, Any]:
    """Perform login using the configured strategy and return captured cookies."""

    login_type = (site_config or {}).get("login_type", "selenium").lower()
    logging.info(
        "login_and_update dispatcher selected '%s' for %s.",
        login_type,
        config_name,
    )

    if login_type == "selenium":
        return _login_with_selenium(
            config_name,
            site_config,
            login_credentials,
            driver_factory=driver_factory,
        )
    if login_type == "api":
        return _login_with_api(config_name, site_config, login_credentials)

    message = f"Unsupported login type '{login_type}' for {config_name}."
    logging.error(message)
    return {"cookies": [], "login_type": login_type, "error": message}
