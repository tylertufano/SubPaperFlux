import os
import sys
import argparse
import configparser
import json
import time
import requests
import re
import logging
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
from oauthlib.oauth1 import Client as OAuth1Client
from urllib.parse import urlencode

try:
    import feedparser
except ImportError:
    logging.error("feedparser library not found. Please install it with 'pip install feedparser'.")
    sys.exit(1)

# --- Configure Execution Based on Environment Variables ---
DEBUG_LOGGING = os.getenv('DEBUG_LOGGING', '0').lower() in ('1', 'true')
ENABLE_SCREENSHOTS = os.getenv('ENABLE_SCREENSHOTS', '0').lower() in ('1', 'true')
log_dir = "selenium_logs"
os.makedirs(log_dir, exist_ok=True)

# --- Setup Logging ---
log_level = logging.DEBUG if DEBUG_LOGGING else logging.INFO
logging.basicConfig(
    level=log_level,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    datefmt='[%Y-%m-%d %H:%M:%S]'
)
if DEBUG_LOGGING:
    logging.getLogger('oauthlib').setLevel(logging.DEBUG)
    logging.getLogger('requests_oauthlib').setLevel(logging.DEBUG)

# --- Suppress webdriver-manager logs ---
logging.getLogger('webdriver_manager').setLevel(logging.WARNING)

# --- Setup WebDriver Options and Service ---
options = Options()
options.add_argument("--headless=new")
options.add_argument("--disable-gpu")
options.add_argument("--no-sandbox")
options.add_argument("--window-size=1920,1080")
options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/533.36")
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
    logging.error(f"Failed to initialize Chrome driver: {e}. Ensure Chrome is installed and updated.")
    sys.exit(1)

# --- Instapaper API Constants ---
INSTAPAPER_ADD_URL = "https://www.instapaper.com/api/1.1/bookmarks/add"
INSTAPAPER_OAUTH_TOKEN_URL = "https://www.instapaper.com/api/1/oauth/access_token"
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
    value = int(re.findall(r'\d+', freq_str)[0])
    unit = re.findall(r'[a-z]', freq_str)[0]

    if unit == 's':
        return value
    elif unit == 'm':
        return value * 60
    elif unit == 'h':
        return value * 3600
    elif unit == 'd':
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
            with open(credentials_file_path, 'r') as f:
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
            with open(site_configs_file_path, 'r') as f:
                all_site_configs = json.load(f)
            logging.info(f"Successfully loaded site configurations from site_configs.json.")
            return all_site_configs
        except (IOError, json.JSONDecodeError) as e:
            logging.error(f"Error reading or parsing site_configs.json file: {e}")
            return {}
    else:
        logging.error(f"Site configurations file {site_configs_file_path} not found. Exiting.")
        sys.exit(1)

def save_credentials_to_json(config_dir, all_configs):
    """
    Saves the credentials dictionary to credentials.json.
    """
    credentials_file_path = os.path.join(config_dir, "credentials.json")
    try:
        with open(credentials_file_path, 'w') as f:
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
            with open(app_creds_path, 'r') as f:
                app_creds = json.load(f)
            logging.info("Successfully loaded Instapaper application credentials.")
            return app_creds
        except (IOError, json.JSONDecodeError) as e:
            logging.error(f"Error reading or parsing instapaper_app_creds.json file: {e}")
            return {}
    else:
        logging.error(f"Instapaper application credentials file {app_creds_path} not found. Exiting.")
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
        'last_rss_timestamp': min_datetime,
        'last_rss_poll_time': min_datetime,
        'last_miniflux_refresh_time': min_datetime,
        'force_run': False,
        'force_sync_and_purge': False,  # New flag for force sync/purge
        'bookmarks': {}  # New key for tracking bookmarks
    }

    if os.path.exists(ctrl_file_path):
        try:
            with open(ctrl_file_path, 'r') as f:
                data = json.load(f)

                # Helper function to load a string and make it timezone-aware
                def load_aware_datetime(dt_str):
                    if dt_str:
                        dt_obj = datetime.fromisoformat(dt_str)
                        if dt_obj.tzinfo is None or dt_obj.tzinfo.utcoffset(dt_obj) is None:
                            # It's naive, so make it aware in UTC
                            return dt_obj.replace(tzinfo=timezone.utc)
                        return dt_obj
                    return min_datetime

                state['last_rss_timestamp'] = load_aware_datetime(data.get('last_rss_timestamp'))
                state['last_rss_poll_time'] = load_aware_datetime(data.get('last_rss_poll_time'))
                state['last_miniflux_refresh_time'] = load_aware_datetime(data.get('last_miniflux_refresh_time'))

                state['force_run'] = data.get('force_run', False)
                state['force_sync_and_purge'] = data.get('force_sync_and_purge', False) # Load new flag
                state['bookmarks'] = data.get('bookmarks', {})

            logging.info(f"Successfully loaded state for {os.path.basename(config_file)}.")
            logging.info(f"  - Last RSS entry processed: {state['last_rss_timestamp'].isoformat()}")
            logging.info(f"  - Last RSS poll time: {state['last_rss_poll_time'].isoformat()}")
            logging.info(f"  - Last Miniflux refresh time: {state['last_miniflux_refresh_time'].isoformat()}")
            logging.debug(f"  - Bookmarks tracked: {len(state['bookmarks'])}")
        except (IOError, json.JSONDecodeError, ValueError) as e:
            logging.warning(f"Could not read or parse {ctrl_file_path}. Starting with clean state. Error: {e}")
    else:
        logging.info(f"No state file found for {os.path.basename(config_file)}. A new one will be created.")

    return state

def save_state(config_file, state):
    """Saves the state to the .ctrl file."""
    base_name = os.path.splitext(os.path.basename(config_file))[0]
    ctrl_file_path = os.path.join(os.path.dirname(config_file), f"{base_name}.ctrl")

    # Convert datetime objects to ISO 8601 strings for JSON serialization
    state_to_save = {
        'last_rss_timestamp': state['last_rss_timestamp'].isoformat(),
        'last_rss_poll_time': state['last_rss_poll_time'].isoformat(),
        'last_miniflux_refresh_time': state['last_miniflux_refresh_time'].isoformat(),
        'force_run': state['force_run'],
        'force_sync_and_purge': state['force_sync_and_purge'], # Save new flag
        'bookmarks': state['bookmarks']
    }

    try:
        with open(ctrl_file_path, 'w') as f:
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
            with open(cookie_file_path, 'r') as f:
                cookies_state = json.load(f)
            logging.info("Successfully loaded cookies from cookie_state.json.")
        except (IOError, json.JSONDecodeError) as e:
            logging.warning(f"Could not read or parse {cookie_file_path}. Starting with no cached cookies. Error: {e}")
    else:
        logging.info(f"No cookie state file found. A new one will be created.")
    return cookies_state

def save_cookies_to_json(config_dir, cookies_state):
    """Saves the entire cookies dictionary to cookie_state.json."""
    cookie_file_path = os.path.join(config_dir, "cookie_state.json")
    try:
        with open(cookie_file_path, 'w') as f:
            json.dump(cookies_state, f, indent=4)
        logging.debug(f"Cookies state successfully saved to {cookie_file_path}.")
    except IOError as e:
        logging.error(f"Could not save cookies state to {cookie_file_path}. Error: {e}")

def check_cookies_expiry(cookies, cookies_to_store_names=None):
    """
    Checks if any cookie in the list that is required by the current
    configuration has a Unix timestamp that is in the past.
    Returns True if any required cookie is expired, False otherwise.
    """
    cookies_to_check = cookies
    if cookies_to_store_names and isinstance(cookies_to_store_names, list):
        cookies_to_check = [c for c in cookies if c['name'] in cookies_to_store_names]

    current_time = time.time()
    for cookie in cookies_to_check:
        # Cookies from Selenium have 'expiry', requests cookies have 'expires'
        expiry_timestamp = cookie.get('expiry') or cookie.get('expires')
        if expiry_timestamp and expiry_timestamp <= current_time:
            logging.info(f"A required cookie named '{cookie.get('name')}' has expired. Triggering re-login.")
            return True
    return False

def update_miniflux_feed_with_cookies(miniflux_config_json, cookies, config_name, feed_ids_str):
    """
    Updates all specified Miniflux feeds with captured cookies.
    """
    if not miniflux_config_json:
        logging.debug(f"Miniflux config missing for {config_name}. Skipping.")
        return

    miniflux_url = miniflux_config_json.get('miniflux_url')
    api_key = miniflux_config_json.get('api_key')

    if not all([miniflux_url, api_key, feed_ids_str]):
        logging.warning(f"Miniflux configuration (URL, API key or feed ID) is incomplete. Skipping cookie update.")
        return

    for feed_id in feed_ids_str.split(','):
        try:
            feed_id = int(feed_id.strip())
        except ValueError:
            logging.warning(f"Invalid feed_ids format in Miniflux configuration for {config_name}. Skipping cookie update.")
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
            response = requests.put(api_endpoint, headers=headers, json=payload, timeout=20)
            response.raise_for_status()
            logging.info(f"Miniflux feed {feed_id} updated successfully with new cookies.")
            logging.debug(f"Miniflux API Response Status: {response.status_code}")
            logging.debug(f"Miniflux API Response Body: {response.json()}")
        except requests.exceptions.RequestException as e:
            logging.error(f"Error updating Miniflux feed {feed_id}: {e}")
            if 'response' in locals():
                logging.debug(f"Miniflux API Response Text: {response.text}")

def get_instapaper_tokens(consumer_key, consumer_secret, username, password):
    """
    Obtains OAuth access tokens for Instapaper using username and password.
    Returns a dictionary with 'oauth_token' and 'oauth_token_secret' on success.
    """
    logging.info("Attempting to obtain Instapaper OAuth tokens...")
    logging.debug(f"Using consumer_key: {consumer_key}")
    logging.debug(f"Using username: {username}")

    try:
        oauth = OAuth1Client(consumer_key, client_secret=consumer_secret, signature_method='HMAC-SHA1')

        body_params = {
            'x_auth_username': username,
            'x_auth_password': password,
            'x_auth_mode': 'client_auth'
        }

        uri, headers, body = oauth.sign(
            uri=INSTAPAPER_OAUTH_TOKEN_URL,
            http_method='POST',
            body=body_params,
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )

        logging.debug(f"Signed request URI: {uri}")
        logging.debug(f"Signed request headers: {headers}")
        logging.debug(f"Request body parameters: {body_params}")

        response = requests.post(uri, headers=headers, data=body_params, timeout=30)
        response.raise_for_status()

        logging.debug(f"Raw response from Instapaper: {response.text}")

        token_data = dict(re.findall(r'(\w+)=([^&]+)', response.text))

        if 'oauth_token' in token_data and 'oauth_token_secret' in token_data:
            logging.info("Successfully obtained Instapaper tokens.")
            logging.debug(f"Obtained tokens: {token_data}")
            return token_data
        else:
            logging.error("Failed to get tokens. Response format was not as expected.")
            logging.debug(f"Final parsed token data: {token_data}")
            return None

    except requests.exceptions.RequestException as e:
        logging.error(f"Error obtaining Instapaper tokens: {e}")
        if 'response' in locals():
            logging.debug(f"Instapaper API Response Text: {response.text}")
        return None
    except Exception as e:
        logging.error(f"An unexpected error occurred while getting tokens: {e}")
        return None

def get_article_html_with_cookies(url, cookies):
    """
    Fetches the full HTML content of an article using authentication cookies.
    Returns the HTML content or None on failure.
    """
    if not cookies:
        logging.debug("No cookies provided. Cannot fetch full article HTML.")
        return None

    logging.debug(f"Attempting to fetch full article HTML from URL: {url}")

    session = requests.Session()
    for cookie in cookies:
        session.cookies.set(cookie['name'], cookie['value'])

    try:
        response = session.get(url, timeout=30)
        response.raise_for_status()
        logging.debug(f"Successfully fetched article content from {url}.")
        return response.text
    except requests.exceptions.RequestException as e:
        logging.error(f"Error fetching article content with cookies from {url}: {e}")
        if 'response' in locals():
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
            if folder.get('title') == folder_name:
                logging.info(f"Found existing folder '{folder_name}' with ID: {folder['folder_id']}")
                return folder['folder_id']

    except Exception as e:
        logging.error(f"Error listing Instapaper folders: {e}")
        if 'response' in locals():
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
        payload = {'title': folder_name}
        response = oauth_session.post(INSTAPAPER_FOLDERS_ADD_URL, data=payload)
        response.raise_for_status()

        new_folder = json.loads(response.text)
        new_id = new_folder[0].get('folder_id')
        if new_id:
            logging.info(f"Successfully created new folder '{folder_name}' with ID: {new_id}")
            return new_id
        else:
            logging.error(f"Failed to create folder. Response did not contain a folder ID.")
            if 'response' in locals():
                logging.debug(f"Instapaper API Response Text: {response.text}")
            return None

    except Exception as e:
        logging.error(f"Error creating Instapaper folder: {e}")
        if 'response' in locals():
            # Instapaper returns a 400 Bad Request if the folder already exists.
            # We can handle this as a success.
            if response.status_code == 400 and "Folder already exists" in response.text:
                logging.info(f"Folder '{folder_name}' already exists. Handling as success.")
                return get_instapaper_folder_id(oauth_session, folder_name)
            logging.debug(f"Instapaper API Response Text: {response.text}")
        return None

def publish_to_instapaper(instapaper_config, app_creds, url, title, raw_html_content, categories_from_feed, resolve_final_url=True, sanitize_content=False, tags_string='', folder_id=None, add_default_tag=True, add_categories_as_tags=False):
    """
    Publishes a single article entry to Instapaper.
    Returns a dictionary with 'bookmark_id' and 'content_location' on success, or None on failure.
    """
    try:
        consumer_key = app_creds.get('consumer_key')
        consumer_secret = app_creds.get('consumer_secret')
        oauth_token = instapaper_config.get('oauth_token')
        oauth_token_secret = instapaper_config.get('oauth_token_secret')

        if not all([consumer_key, consumer_secret, oauth_token, oauth_token_secret]):
            logging.error("Incomplete Instapaper credentials. Cannot publish.")
            return None

        oauth = OAuth1Session(consumer_key,
                              client_secret=consumer_secret,
                              resource_owner_key=oauth_token,
                              resource_owner_secret=oauth_token_secret)

        payload = {
            'url': url,
            'title': title,
        }

        # Conditionally add content if provided
        if raw_html_content:
            # 1. Extract only the HTML body content
            body_match = re.search(r'<body.*?>(.*?)</body>', raw_html_content, re.DOTALL | re.I)
            processed_content = body_match.group(1) if body_match else raw_html_content

            # 2. Conditionally sanitize the content
            if sanitize_content:
                logging.debug("Sanitizing content: Removing <img> tags.")
                processed_content = re.sub(r'<img[^>]+>', '', processed_content, flags=re.I)
            
            payload['content'] = processed_content
            logging.debug(f"Payload includes HTML content (truncated): {payload['content'][:100]}...")
        else:
            logging.debug("Payload does not include HTML content. Instapaper will attempt to resolve the URL.")

        # Explicitly set resolve_final_url to '0' if the config is false
        if not resolve_final_url:
            payload['resolve_final_url'] = '0'

        # Conditionally add tags if they are provided, formatted as a JSON string
        final_tags = set()
        if tags_string:
            final_tags.update([tag.strip() for tag in tags_string.split(',') if tag.strip()])

        # Add the default tag if enabled
        if add_default_tag:
            final_tags.add('RSS')
            logging.debug("Adding default 'RSS' tag.")

        # Add categories as tags if the new flag is true
        if add_categories_as_tags and categories_from_feed:
            logging.debug(f"Adding categories as tags: {categories_from_feed}")
            for cat in categories_from_feed:
                final_tags.add(cat)

        if final_tags:
            tags_list = [{'name': tag} for tag in final_tags]
            payload['tags'] = json.dumps(tags_list)
            logging.debug(f"Formatted tags being sent: '{payload['tags']}'.")
        else:
            logging.debug("No tags will be added to this bookmark.")


        # Conditionally add folder ID
        if folder_id:
            payload['folder_id'] = folder_id

        logging.debug(f"Publishing URL: {url}")
        logging.debug(f"Publishing Title: {title}")
        
        if 'resolve_final_url' in payload:
            logging.debug("'resolve_final_url' parameter is set to '0' to prevent URL resolution.")
        else:
            logging.debug("'resolve_final_url' parameter is not explicitly set. Instapaper will resolve redirects.")
        if sanitize_content:
            logging.debug("Content sanitization is ENABLED.")
        else:
        # User defined a parameter, but we want to ignore it if no value is assigned.
            pass
        if folder_id:
            logging.debug(f"Folder ID being used: '{folder_id}'.")
        
        # Log the full payload being sent to the API
        logging.debug(f"Payload being sent to Instapaper: {payload}")

        # Use `data` parameter to send the payload as application/x-www-form-urlencoded
        response = oauth.post(INSTAPAPER_ADD_URL, data=payload)
        response.raise_for_status()

        # Log the raw response text regardless of its content
        logging.debug(f"Raw response text from Instapaper: {response.text}")
        content_location = response.headers.get('Content-Location')
        logging.debug(f"Content-Location header: {content_location}")

        response_json = response.json()
        bookmark_id = None
        for item in response_json:
            if item.get('type') == 'bookmark':
                bookmark_id = item.get('bookmark_id')
                break

        if bookmark_id:
            logging.info(f"Successfully published '{title}' to Instapaper. Bookmark ID: {bookmark_id}")
            logging.debug(f"Instapaper API Response Status: {response.status_code}")
            return {
                'bookmark_id': bookmark_id,
                'content_location': content_location,
                'title': title
            }
        else:
            logging.error(f"Failed to retrieve bookmark_id from successful response for '{title}'.")
            return None

    except Exception as e:
        logging.error(f"Error publishing to Instapaper: {e}")
        if 'response' in locals():
            logging.debug(f"Instapaper API Response Text: {response.text}")
        return None

def get_new_rss_entries(config_file, feed_url, instapaper_config, app_creds, rss_feed_config, instapaper_ini_config, cookies, state):
    """
    Fetches the RSS feed from a given URL and returns a list of new entries.
    Accepts an optional `cookies` argument for authenticated content fetching.
    """
    last_run_dt = state['last_rss_timestamp']
    new_entries = []

    logging.debug(f"Last RSS entry timestamp from state: {last_run_dt.isoformat()}")

    try:
        # Load the two new, independent flags
        rss_requires_auth = rss_feed_config.getboolean('rss_requires_auth', fallback=False)
        is_paywalled = rss_feed_config.getboolean('is_paywalled', fallback=False)
        
        # Determine if we need to use a session with cookies for the RSS feed
        if rss_requires_auth and cookies:
            logging.info(f"Feed is marked as private. Fetching RSS feed from {feed_url} with cookies.")
            session = requests.Session()
            for cookie in cookies:
                session.cookies.set(cookie['name'], cookie['value'])
            feed_response = session.get(feed_url, timeout=30)
        else:
            logging.info(f"Feed is public. Fetching RSS feed from {feed_url} without cookies.")
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/533.36'}
            feed_response = requests.get(feed_url, headers=headers, timeout=30)

        feed_response.raise_for_status()
        feed = feedparser.parse(feed_response.content)
        logging.debug(f"Found {len(feed.entries)} entries in the RSS feed.")

        # Extract feed-level categories
        feed_categories = set()
        if hasattr(feed.feed, 'tags'):
            for tag in feed.feed.tags:
                if 'term' in tag:
                    feed_categories.add(tag['term'])
        if hasattr(feed.feed, 'category'):
            feed_categories.add(feed.feed.category)
        
        logging.debug(f"Feed-level categories: {list(feed_categories)}")

        for entry in feed.entries:
            entry_timestamp_dt = None
            if hasattr(entry, 'published_parsed'):
                entry_timestamp_dt = datetime.fromtimestamp(time.mktime(entry.published_parsed), tz=timezone.utc)
            elif hasattr(entry, 'updated_parsed'):
                entry_timestamp_dt = datetime.fromtimestamp(time.mktime(entry.updated_parsed), tz=timezone.utc)

            logging.debug(f"Processing entry '{entry.title}'. Timestamp: {entry_timestamp_dt}")

            if entry_timestamp_dt and entry_timestamp_dt > state['last_rss_timestamp']:
                url = entry.link
                title = entry.title

                # Extract entry-specific categories
                entry_categories = set(feed_categories) # Start with feed categories
                if hasattr(entry, 'tags'):
                    for tag in entry.tags:
                        if 'term' in tag:
                            entry_categories.add(tag['term'])
                if hasattr(entry, 'category'):
                    entry_categories.add(entry.category)
                
                # Convert to a list for JSON serialization later
                categories_list = list(entry_categories)
                
                raw_html_content = None
                
                if is_paywalled and cookies:
                    logging.info(f"Article is paywalled. Attempting to fetch full HTML body with cookies from {url}.")
                    raw_html_content = get_article_html_with_cookies(url, cookies)
                else:
                    logging.info("Article is not paywalled. Sending URL-only request to Instapaper.")
                
                # Check if we have content to send to Instapaper
                if raw_html_content or not is_paywalled:
                    new_entry = {
                        'config_file': config_file,
                        'url': url,
                        'title': title,
                        'raw_html_content': raw_html_content,
                        'published_dt': entry_timestamp_dt,
                        'categories_from_feed': categories_list,
                        'instapaper_config': instapaper_config,
                        'app_creds': app_creds,
                        'rss_feed_config': rss_feed_config,
                        'instapaper_ini_config': instapaper_ini_config,
                    }
                    new_entries.append(new_entry)
                    logging.info(f"Found new entry: '{title}' from {entry_timestamp_dt.isoformat()}")
                else:
                    logging.warning(f"Skipping entry '{title}' as no content could be retrieved and it's marked as paywalled.")

        logging.info(f"Found {len(new_entries)} new entries from this feed.")

    except requests.exceptions.RequestException as e:
        logging.error(f"Error fetching RSS feed: {e}")
        if 'response' in locals():
            logging.debug(f"HTTP status code: {feed_response.status_code}")
            logging.debug(f"HTTP response body: {feed_response.text}")
    except Exception as e:
        logging.error(f"An unexpected error occurred while processing feed: {e}")

    return new_entries

def sync_instapaper_bookmarks(instapaper_config, app_creds, bookmarks_to_sync):
    """
    Syncs the local list of bookmarks with Instapaper using the 'have' parameter.
    Modifies the bookmarks_to_sync dictionary in place.
    """
    if not bookmarks_to_sync:
        logging.info("No bookmarks to sync in local state. Skipping.")
        return

    logging.info(f"Starting Instapaper bookmark sync for {len(bookmarks_to_sync)} bookmarks.")

    try:
        oauth = OAuth1Session(app_creds.get('consumer_key'),
                              client_secret=app_creds.get('consumer_secret'),
                              resource_owner_key=instapaper_config.get('oauth_token'),
                              resource_owner_secret=instapaper_config.get('oauth_token_secret'))
        
        # Prepare the 'have' parameter payload
        # The 'have' parameter is a JSON object where keys are the bookmark IDs
        # and values are the last known timestamp, or '0' if not available.
        have_payload = {bookmark_id: '0' for bookmark_id in bookmarks_to_sync.keys()}
        
        logging.debug(f"Using 'have' parameter with {len(have_payload)} bookmark IDs.")
        
        # Make the API call with the 'have' parameter
        response = oauth.post(INSTAPAPER_BOOKMARKS_LIST_URL, data={'have': json.dumps(have_payload)})
        response.raise_for_status()
        
        logging.debug(f"Raw Instapaper sync response: {response.text}")
        
        # --- FIXED LOGIC: Handle the top-level dictionary response ---
        api_response_data = response.json()
        
        # The bookmarks are in a list under the 'bookmarks' key.
        # The API documentation is slightly misleading, the response is a dictionary, not an array.
        returned_items = api_response_data.get('bookmarks', [])
        
        deleted_count = 0
        
        for item in returned_items:
            # Check if the item is a dictionary as expected
            if isinstance(item, dict):
                if item.get('type') == 'delete':
                    deleted_bookmark_id = item.get('bookmark_id')
                    if deleted_bookmark_id in bookmarks_to_sync:
                        del bookmarks_to_sync[deleted_bookmark_id]
                        logging.info(f"Found deleted bookmark. Removing from local state. Bookmark ID: {deleted_bookmark_id}")
                        deleted_count += 1
            else:
                logging.warning(f"Unexpected item type in sync response: {type(item)}. Skipping.")
        
        logging.info(f"Sync complete. {deleted_count} bookmarks removed from local state.")

    except Exception as e:
        logging.error(f"Error during Instapaper bookmark sync: {e}")
        if 'response' in locals():
            logging.debug(f"Instapaper API Response Text: {response.text}")

def apply_retention_policy(instapaper_ini_config, instapaper_config, app_creds, bookmarks_to_sync):
    """
    Deletes bookmarks from Instapaper that have exceeded the defined retention period.
    Modifies the bookmarks_to_sync dictionary in place.
    """
    retention_str = instapaper_ini_config.get('retention', '')
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
            publish_time_str = bookmark_data.get('published_timestamp')
            if not publish_time_str:
                logging.warning(f"Bookmark ID {bookmark_id} has no publish timestamp. Skipping retention check.")
                continue

            publish_time = datetime.fromisoformat(publish_time_str)
            
            # Make sure the publish time is timezone-aware
            if publish_time.tzinfo is None or publish_time.tzinfo.utcoffset(publish_time) is None:
                publish_time = publish_time.replace(tzinfo=timezone.utc)

            if (current_time - publish_time).total_seconds() > retention_seconds:
                bookmarks_to_delete_ids.append(bookmark_id)
                logging.info(f"Bookmark ID {bookmark_id} is older than the retention policy. Marked for deletion.")

        except ValueError as e:
            logging.warning(f"Error parsing timestamp for bookmark ID {bookmark_id}: {e}. Skipping.")
            continue
    
    if not bookmarks_to_delete_ids:
        logging.info("No bookmarks found that have exceeded the retention period.")
        return

    logging.info(f"Deleting {len(bookmarks_to_delete_ids)} bookmarks from Instapaper.")
    deleted_count = 0
    
    try:
        oauth = OAuth1Session(app_creds.get('consumer_key'),
                              client_secret=app_creds.get('consumer_secret'),
                              resource_owner_key=instapaper_config.get('oauth_token'),
                              resource_owner_secret=instapaper_config.get('oauth_token_secret'))

        for bookmark_id in bookmarks_to_delete_ids:
            try:
                payload = {'bookmark_id': bookmark_id}
                response = oauth.post(INSTAPAPER_BOOKMARKS_DELETE_URL, data=payload)
                response.raise_for_status()
                
                # --- NEW LOGIC: Relying on successful HTTP status for confirmation ---
                del bookmarks_to_sync[bookmark_id]
                logging.info(f"Successfully deleted bookmark {bookmark_id} from Instapaper and local state.")
                deleted_count += 1
                # --- END NEW LOGIC ---
            
            except requests.exceptions.RequestException as e:
                logging.error(f"Failed to delete bookmark {bookmark_id}: {e}. Will not remove from local state.")
                if 'response' in locals():
                    logging.debug(f"Instapaper API Response Text: {response.text}")
    
    except Exception as e:
        logging.error(f"An error occurred during Instapaper API communication: {e}.")
    
    logging.info(f"Retention policy applied. {deleted_count} bookmarks deleted from Instapaper and local state.")

def get_config_files(path):
    """Parses the command-line argument to return a list of INI files."""
    if os.path.isfile(path) and path.endswith('.ini'):
        return [path]
    elif os.path.isdir(path):
        return glob(os.path.join(path, '*.ini'))
    else:
        logging.error("Invalid path provided. Please specify a .ini file or a directory containing .ini files.")
        sys.exit(1)

def run_service(config_path, all_configs, all_site_configs, instapaper_app_creds, all_cookie_state):
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

                if 'CONFIG_REFERENCES' not in config:
                    logging.warning(f"Missing [CONFIG_REFERENCES] section in {config_name}. Skipping this config.")
                    continue
                ref_config = config['CONFIG_REFERENCES']

                login_id = ref_config.get('login_id')
                site_config_id = ref_config.get('site_config_id')
                instapaper_id = ref_config.get('instapaper_id')
                miniflux_id = ref_config.get('miniflux_id')

                cookie_key = f"{login_id}-{site_config_id}"

                login_credentials = all_configs.get(login_id)
                site_config = all_site_configs.get(site_config_id)
                instapaper_config_from_json = all_configs.get(instapaper_id)
                miniflux_config_from_json = all_configs.get(miniflux_id)

                instapaper_ini_config = config['INSTAPAPER_CONFIG'] if 'INSTAPAPER_CONFIG' in config else {}
                rss_feed_config = config['RSS_FEED_CONFIG'] if 'RSS_FEED_CONFIG' in config else {}
                miniflux_ini_config = config['MINIFLUX_CONFIG'] if 'MINIFLUX_CONFIG' in config else {}
                
                # --- New Validation Check for Configuration Mismatch ---
                is_paywalled = rss_feed_config.getboolean('is_paywalled', fallback=False) if rss_feed_config else False
                rss_requires_auth = rss_feed_config.getboolean('rss_requires_auth', fallback=False) if rss_feed_config else False
                
                if (is_paywalled or rss_requires_auth) and (not login_id or not site_config_id):
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
                    cached_cookies = cached_cookies_data.get('cookies', [])
                    cookies_to_store_names = site_config.get('cookies_to_store', []) if site_config else []
                    cookies_expired = check_cookies_expiry(cached_cookies, cookies_to_store_names)
                    
                    required_cookie_missing = False
                    if cookies_to_store_names:
                        cached_cookie_names = {c['name'] for c in cached_cookies}
                        if not all(name in cached_cookie_names for name in cookies_to_store_names):
                            required_cookie_missing = True
                    
                    imminent_expiry = False
                    miniflux_refresh_frequency_sec = 0
                    if miniflux_ini_config and miniflux_ini_config.get('refresh_frequency'):
                        miniflux_refresh_frequency_sec = parse_frequency_to_seconds(miniflux_ini_config.get('refresh_frequency'))
                    rss_poll_frequency_sec = 0
                    if rss_feed_config:
                        poll_frequency_str = rss_feed_config.get('poll_frequency')
                        if not poll_frequency_str:
                            poll_frequency_str = '1h'  # Default value
                        rss_poll_frequency_sec = parse_frequency_to_seconds(poll_frequency_str)
                    
                    if cached_cookies and cookies_to_store_names:
                        min_expiry_timestamp = float('inf')
                        required_cookies_with_expiry = [c for c in cached_cookies if c.get('name') in cookies_to_store_names and c.get('expiry')]
                        if required_cookies_with_expiry:
                            min_expiry_timestamp = min(c['expiry'] for c in required_cookies_with_expiry)
                        
                        next_miniflux_refresh_time = state['last_miniflux_refresh_time'] + timedelta(seconds=miniflux_refresh_frequency_sec)
                        next_rss_poll_time = state['last_rss_poll_time'] + timedelta(seconds=rss_poll_frequency_sec)
                        
                        if min_expiry_timestamp <= next_miniflux_refresh_time.timestamp() or min_expiry_timestamp <= next_rss_poll_time.timestamp():
                            imminent_expiry = True

                    # The logic to decide if a login should be performed
                    should_perform_login = (
                        not cached_cookies or
                        cookies_expired or
                        required_cookie_missing or
                        imminent_expiry or
                        state.get('force_run', False) # This flag allows an external override
                    )

                    if should_perform_login:
                        reasons = []
                        if not cached_cookies: reasons.append("No cached cookies found")
                        if cookies_expired: reasons.append("Cookies expired")
                        if required_cookie_missing: reasons.append("Required cookie missing")
                        if imminent_expiry: reasons.append("Imminent expiry")
                        if state.get('force_run', False): reasons.append("Force Run flag set")
                        logging.info(f"Triggering login for {config_name}. Reasons: {', '.join(reasons)}")

                        cookies = login_and_update(config_name, site_config, login_credentials)

                        if cookies:
                            all_cookie_state[cookie_key] = {
                                'cookies': cookies,
                                'last_refresh': current_time.isoformat()
                            }
                            save_cookies_to_json(os.path.dirname(config_file), all_cookie_state)
                            # Update state timestamps after a successful login
                            state['last_miniflux_refresh_time'] = current_time
                            state['last_rss_poll_time'] = current_time
                        else:
                            logging.warning(f"Login failed for {config_name}. Cannot update state with new cookies.")
                        
                        state['force_run'] = False
                        save_state(config_file, state)
                    else:
                        cookies = cached_cookies
                        logging.info(f"Using cached cookies for {config_name}. Login was not required.")
                else:
                    logging.warning(f"Bypassing login and cookie caching for {config_name}. Missing login credentials or site configuration.")
                    cookies = []
                    
                # --- Scheduled Actions (Miniflux and RSS) ---
                miniflux_refresh_due = False
                rss_poll_due = False
                
                # Check due times based on the state file
                miniflux_refresh_frequency_sec = 0
                if miniflux_ini_config and miniflux_ini_config.get('refresh_frequency'):
                    miniflux_refresh_frequency_sec = parse_frequency_to_seconds(miniflux_ini_config.get('refresh_frequency'))
                    if (current_time - state['last_miniflux_refresh_time']).total_seconds() >= miniflux_refresh_frequency_sec:
                        miniflux_refresh_due = True
                    else:
                        logging.info(f"Miniflux refresh for {config_name} not yet due.")

                rss_poll_frequency_sec = 0
                if rss_feed_config:
                    poll_frequency_str = rss_feed_config.get('poll_frequency')
                    if not poll_frequency_str:
                        poll_frequency_str = '1h'  # Default value
                        logging.info("RSS poll frequency not configured. Using default of 1h.")
                    
                    rss_poll_frequency_sec = parse_frequency_to_seconds(poll_frequency_str)
                    
                    if (current_time - state['last_rss_poll_time']).total_seconds() >= rss_poll_frequency_sec:
                        rss_poll_due = True
                    else:
                        logging.info(f"RSS poll for {config_name} not yet due.")
                        
                # Special case: If this is the first time running for a given INI file,
                # we force a poll to catch all initial entries.
                if state['last_rss_timestamp'] == datetime.fromtimestamp(0, tz=timezone.utc):
                    rss_poll_due = True
                    logging.info("First run detected for this INI's state file. All entries from RSS feed will be processed.")

                # Miniflux Update Logic
                if miniflux_config_from_json and miniflux_refresh_due:
                    feed_ids_str = miniflux_ini_config.get('feed_ids')
                    if feed_ids_str:
                        logging.info(f"Updating Miniflux feed(s) with most recent cookies for {config_name}.")
                        update_miniflux_feed_with_cookies(miniflux_config_from_json, cookies, config_name, feed_ids_str)
                        state['last_miniflux_refresh_time'] = current_time
                        save_state(config_file, state)
                    else:
                        logging.warning(f"Skipping Miniflux update for {config_name}: 'feed_ids' is missing from INI file.")
                else:
                    if not miniflux_config_from_json:
                        logging.info(f"Skipping Miniflux update for {config_name}: Configuration not found in credentials.json.")
                    # (The 'not yet due' case is handled above)

                # RSS Polling Logic
                if instapaper_config_from_json and rss_feed_config and rss_poll_due:
                    feed_url = rss_feed_config.get('feed_url')
                    if feed_url:
                        logging.info("Starting RSS polling and state update sequence.")
                        logging.info(f"Polling RSS feed for new entries ({config_name})")
                        new_entries = get_new_rss_entries(
                            config_file,
                            feed_url,
                            instapaper_config_from_json,
                            instapaper_app_creds,
                            rss_feed_config,
                            instapaper_ini_config,
                            cookies,
                            state
                        )
                        all_new_entries.extend(new_entries)
                        state['last_rss_poll_time'] = current_time
                        save_state(config_file, state)
                        logging.info("RSS polling and state update sequence finished.")
                    else:
                        logging.warning(f"Skipping RSS to Instapaper for {config_name}: 'feed_url' is missing.")
                else:
                    if not instapaper_config_from_json:
                        logging.info(f"Skipping RSS poll for {config_name}: Instapaper configuration not found in credentials.json.")
                    elif not rss_feed_config:
                        logging.info(f"Skipping RSS poll for {config_name}: RSS feed configuration not found in INI file.")
                    # (The 'not yet due' case is handled above, with the exception of the first run)
            
            except (configparser.Error, KeyError) as e:
                logging.error(f"Error reading or parsing INI file {config_file}: {e}")
                continue

        if all_new_entries:
            logging.info("Found new entries across all feeds. Sorting and publishing chronologically.")
            all_new_entries.sort(key=lambda x: x['published_dt'])

            published_count = 0
            for entry in all_new_entries:
                instapaper_config_from_json = entry['instapaper_config']
                app_creds = entry['app_creds']
                instapaper_ini_config = entry['instapaper_ini_config']
                config_file_for_entry = entry['config_file']

                try:
                    resolve_final_url_flag = instapaper_ini_config.getboolean('resolve_final_url', fallback=True)
                    sanitize_content_flag = instapaper_ini_config.getboolean('sanitize_content', fallback=False)
                    add_default_tag_flag = instapaper_ini_config.getboolean('add_default_tag', fallback=True)
                    add_categories_as_tags_flag = instapaper_ini_config.getboolean('add_categories_as_tags', fallback=False)
                except ValueError as e:
                    logging.warning(f"Invalid boolean value for Instapaper config: {e}. Defaulting to fallback values.")
                    resolve_final_url_flag = True
                    sanitize_content_flag = False
                    add_default_tag_flag = True
                    add_categories_as_tags_flag = False

                tags_to_add = instapaper_ini_config.get('tags', '')
                folder_name = instapaper_ini_config.get('folder', '')
                categories_for_tags = entry.get('categories_from_feed', [])

                folder_id = None
                if folder_name:
                    oauth_session = OAuth1Session(app_creds.get('consumer_key'),
                                                  client_secret=app_creds.get('consumer_secret'),
                                                  resource_owner_key=instapaper_config_from_json.get('oauth_token'),
                                                  resource_owner_secret=instapaper_config_from_json.get('oauth_token_secret'))
                    folder_id = get_instapaper_folder_id(oauth_session, folder_name)
                    if not folder_id:
                        folder_id = create_instapaper_folder(oauth_session, folder_name)

                publish_result = publish_to_instapaper(
                    instapaper_config_from_json,
                    app_creds,
                    entry['url'],
                    entry['title'],
                    entry['raw_html_content'],
                    categories_from_feed=categories_for_tags,
                    resolve_final_url=resolve_final_url_flag,
                    sanitize_content=sanitize_content_flag,
                    tags_string=tags_to_add,
                    folder_id=folder_id,
                    add_default_tag=add_default_tag_flag,
                    add_categories_as_tags=add_categories_as_tags_flag
                )
                
                if publish_result:
                    state_to_update = load_state(config_file_for_entry)
                    
                    # Store the new bookmark information
                    bookmark_id = publish_result['bookmark_id']
                    state_to_update['bookmarks'][bookmark_id] = {
                        'content_location': publish_result['content_location'],
                        'title': publish_result['title'],
                        'published_timestamp': datetime.now(timezone.utc).isoformat()
                    }
                    
                    # Update the last RSS entry timestamp
                    state_to_update['last_rss_timestamp'] = entry['published_dt']
                    save_state(config_file_for_entry, state_to_update)

                published_count += 1
            
            logging.info(f"Finished publishing. Published {published_count} new entries to Instapaper.")
            
        
        # --- NEW CODE: Sync & Purge Check outside of the new entries block ---
        for config_file in config_files:
            config = configparser.ConfigParser()
            config.read(config_file)
            state_to_sync_purge = load_state(config_file)

            if instapaper_id and state_to_sync_purge.get('force_sync_and_purge', False):
                logging.info(f"Force sync and purge flag detected for {os.path.basename(config_file)}. Running sync and retention policy.")

                instapaper_id = config['CONFIG_REFERENCES'].get('instapaper_id')
                instapaper_config_from_json = all_configs.get(instapaper_id)
                instapaper_ini_config = config['INSTAPAPER_CONFIG'] if 'INSTAPAPER_CONFIG' in config else {}

                sync_instapaper_bookmarks(
                    instapaper_config_from_json,
                    instapaper_app_creds,
                    state_to_sync_purge['bookmarks']
                )

                apply_retention_policy(
                    instapaper_ini_config,
                    instapaper_config_from_json,
                    instapaper_app_creds,
                    state_to_sync_purge['bookmarks']
                )
                
                # Reset the flag after a successful run
                state_to_sync_purge['force_sync_and_purge'] = False
                save_state(config_file, state_to_sync_purge)
                logging.info(f"Force sync and purge finished and flag has been reset for {os.path.basename(config_file)}.")
        # --- END NEW CODE ---

        logging.info("Service poll loop finished. Sleeping for 60 seconds.")
        time.sleep(60)

def main():
    """Main function to parse arguments and start the service loop."""
    parser = argparse.ArgumentParser(description="Run RSS to Instapaper bridge as a continuous service.")
    parser.add_argument("config_path", help="Path to a specific .ini file or a directory containing .ini files.")
    args = parser.parse_args()

    config_dir = os.path.dirname(args.config_path) if os.path.isfile(args.config_path) else args.config_path

    all_external_configs = load_credentials_from_json(config_dir)
    all_site_configs = load_site_configs_from_json(config_dir)
    instapaper_app_creds = load_instapaper_app_creds(config_dir)
    all_cookie_state = load_cookies_from_json(config_dir)

    logging.info("Checking for Instapaper credentials to migrate...")
    config_files = get_config_files(args.config_path)
    for config_file in config_files:
        config = configparser.ConfigParser()
        config.read(config_file)
        if 'CONFIG_REFERENCES' in config and 'instapaper_id' in config['CONFIG_REFERENCES']:
            instapaper_id = config['CONFIG_REFERENCES']['instapaper_id']
            instapaper_config_data = all_external_configs.get(instapaper_id, {})

            if not instapaper_config_data.get('oauth_token') or not instapaper_config_data.get('oauth_token_secret'):
                logging.info(f"Instapaper tokens not found for '{instapaper_id}'. Checking for migration credentials.")

                if 'INSTAPAPER_LOGIN' in config and 'email' in config['INSTAPAPER_LOGIN'] and 'password' in config['INSTAPAPER_LOGIN']:
                    username = config['INSTAPAPER_LOGIN']['email']
                    password = config['INSTAPAPER_LOGIN']['password']

                    if instapaper_app_creds:
                        tokens = get_instapaper_tokens(instapaper_app_creds.get('consumer_key'), instapaper_app_creds.get('consumer_secret'), username, password)

                        if tokens:
                            all_external_configs[instapaper_id]['oauth_token'] = tokens['oauth_token']
                            all_external_configs[instapaper_id]['oauth_token_secret'] = tokens['oauth_token_secret']
                            save_credentials_to_json(config_dir, all_external_configs)

                            config.remove_section('INSTAPAPER_LOGIN')
                            with open(config_file, 'w') as f:
                                config.write(f)

                            logging.info(f"Successfully migrated Instapaper credentials for '{os.path.basename(config_file)}' and cleaned up INI file.")
                        else:
                            logging.error(f"Failed to generate Instapaper tokens for '{os.path.basename(config_file)}'. Please check INI credentials and consumer keys.")
                    else:
                        logging.error(f"Instapaper application credentials not found. Cannot generate tokens.")
                else:
                    logging.warning(f"No Instapaper credentials (email/password) found in '{os.path.basename(config_file)}'. Cannot perform migration.")

    logging.info("Starting the continuous service loop...")
    run_service(args.config_path, all_external_configs, all_site_configs, instapaper_app_creds, all_cookie_state)

if __name__ == "__main__":
    main()