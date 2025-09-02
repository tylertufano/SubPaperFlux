import os
import sys
import argparse
import configparser
import json
import time
import requests
import feedparser
import re
import logging
from datetime import datetime, timedelta
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

# --- Configure Execution Based on Environment Variables ---
DEBUG_LOGGING = os.getenv('DEBUG_LOGGING', '0').lower() in ('1', 'true')
OAUTH_DEBUG_LOGGING = os.getenv('OAUTH_DEBUG_LOGGING', '0').lower() in ('1', 'true')
ENABLE_SCREENSHOTS = os.getenv('ENABLE_SCREENSHOTS', '0').lower() in ('1', 'true')
log_dir = "selenium_logs"
os.makedirs(log_dir, exist_ok=True)

# --- Setup WebDriver Options ---
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

if DEBUG_LOGGING:
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    service_log_path = os.path.join(log_dir, "chromedriver.log")
else:
    service_log_path = os.devnull

if OAUTH_DEBUG_LOGGING:
    # Enable detailed logging for the OAuth library
    logging.basicConfig(level=logging.DEBUG)
    logging.getLogger('oauthlib').setLevel(logging.DEBUG)
    logging.getLogger('requests_oauthlib').setLevel(logging.DEBUG)
    
service = Service(ChromeDriverManager().install(), log_output=service_log_path)

# --- Instapaper API Constants ---
INSTAPAPER_ADD_URL = "https://www.instapaper.com/api/1.1/bookmarks/add"
INSTAPAPER_OAUTH_TOKEN_URL = "https://www.instapaper.com/api/1/oauth/access_token"
INSTAPAPER_FOLDERS_LIST_URL = "https://www.instapaper.com/api/1.1/folders/list"
INSTAPAPER_FOLDERS_ADD_URL = "https://www.instapaper.com/api/1.1/folders/add"

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

def load_state(config_file):
    """Loads the state from the .ctrl file."""
    base_name = os.path.splitext(os.path.basename(config_file))[0]
    ctrl_file_path = os.path.join(os.path.dirname(config_file), f"{base_name}.ctrl")
    
    state = {
        'last_rss_timestamp': datetime.fromtimestamp(0),
        'last_rss_poll_time': datetime.fromtimestamp(0),
        'last_miniflux_refresh_time': datetime.fromtimestamp(0),
    }
    
    if os.path.exists(ctrl_file_path):
        try:
            with open(ctrl_file_path, 'r') as f:
                data = json.load(f)
                
                last_rss_str = data.get('last_rss_timestamp')
                if last_rss_str:
                    state['last_rss_timestamp'] = datetime.fromisoformat(last_rss_str)
                
                last_poll_str = data.get('last_rss_poll_time')
                if last_poll_str:
                    state['last_rss_poll_time'] = datetime.fromisoformat(last_poll_str)
                    
                last_miniflux_str = data.get('last_miniflux_refresh_time')
                if last_miniflux_str:
                    state['last_miniflux_refresh_time'] = datetime.fromisoformat(last_miniflux_str)
                    
            print(f"[{datetime.now()}] Successfully loaded state for {os.path.basename(config_file)}.")
            print(f"  - Last RSS entry processed: {state['last_rss_timestamp'].isoformat()}")
            print(f"  - Last RSS poll time: {state['last_rss_poll_time'].isoformat()}")
            print(f"  - Last Miniflux refresh time: {state['last_miniflux_refresh_time'].isoformat()}")
        except (IOError, json.JSONDecodeError, ValueError) as e:
            print(f"Warning: Could not read or parse {ctrl_file_path}. Starting with clean state. Error: {e}")
            
    else:
        print(f"[{datetime.now()}] No state file found for {os.path.basename(config_file)}. Starting with a clean state.")
    
    return state

def save_state(config_file, state):
    """Saves the state to the .ctrl file."""
    base_name = os.path.splitext(os.path.basename(config_file))[0]
    ctrl_file_path = os.path.join(os.path.dirname(config_file), f"{base_name}.ctrl")

    # Convert datetime objects to ISO 8601 strings for JSON serialization
    state_to_save = {
        'last_rss_timestamp': state['last_rss_timestamp'].isoformat(),
        'last_rss_poll_time': state['last_rss_poll_time'].isoformat(),
        'last_miniflux_refresh_time': state['last_miniflux_refresh_time'].isoformat()
    }

    try:
        with open(ctrl_file_path, 'w') as f:
            json.dump(state_to_save, f, indent=4)
        if DEBUG_LOGGING:
            print(f"DEBUG: State successfully saved to {ctrl_file_path}.")
    except IOError as e:
        print(f"Error: Could not save state to {ctrl_file_path}. Error: {e}")

def update_miniflux_feed_with_cookies(miniflux_config, cookies, config_name):
    """
    Updates all specified Miniflux feeds with captured cookies.
    """
    if not miniflux_config:
        if DEBUG_LOGGING:
            print(f"DEBUG: Miniflux config missing for {config_name}. Skipping.")
        return
        
    miniflux_url = miniflux_config.get('miniflux_url')
    api_key = miniflux_config.get('api_key')
    feed_ids_str = miniflux_config.get('feed_ids')
    if not all([miniflux_url, api_key, feed_ids_str]):
        print(f"Miniflux configuration in {config_name} is incomplete. Skipping cookie update.")
        return

    for feed_id in feed_ids_str.split(','):
        try:
            feed_id = int(feed_id.strip())
        except ValueError:
            print(f"Invalid feed_ids format in Miniflux configuration for {config_name}. Skipping cookie update.")
            continue

        print(f"\n--- Updating Miniflux Feed {feed_id} ---")
        api_endpoint = f"{miniflux_url.rstrip('/')}/v1/feeds/{feed_id}"
        headers = {
            "X-Auth-Token": api_key,
            "Content-Type": "application/json",
        }
        cookie_str = "; ".join([f"{c['name']}={c['value']} " for c in cookies])
        
        if DEBUG_LOGGING:
            print(f"DEBUG: Updating feed {feed_id} at URL: {api_endpoint}")
            print(f"DEBUG: Cookies being sent: {cookie_str}")
        
        payload = {"cookie": cookie_str}

        try:
            response = requests.put(api_endpoint, headers=headers, json=payload, timeout=20)
            response.raise_for_status()
            print(f"Miniflux feed {feed_id} updated successfully with new cookies.")
            if DEBUG_LOGGING:
                print(f"DEBUG: Miniflux API Response Status: {response.status_code}")
                print(f"DEBUG: Miniflux API Response Body: {response.json()}")
        except requests.exceptions.RequestException as e:
            print(f"Error updating Miniflux feed {feed_id}: {e}")
            if 'response' in locals() and DEBUG_LOGGING:
                print(f"DEBUG: Miniflux API Response Text: {response.text}")

def get_instapaper_tokens(consumer_key, consumer_secret, username, password):
    """
    Obtains OAuth access tokens for Instapaper using username and password.
    Returns a dictionary with 'oauth_token' and 'oauth_token_secret' on success.
    """
    print("Attempting to obtain Instapaper OAuth tokens...")
    if DEBUG_LOGGING:
        print(f"DEBUG: Using consumer_key: {consumer_key}")
        print(f"DEBUG: Using username: {username}")
        
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
        
        if DEBUG_LOGGING:
            print(f"DEBUG: Signed request URI: {uri}")
            print(f"DEBUG: Signed request headers: {headers}")
            print(f"DEBUG: Request body parameters: {body_params}")

        response = requests.post(uri, headers=headers, data=body_params, timeout=30)
        response.raise_for_status()
        
        if DEBUG_LOGGING:
            print(f"DEBUG: Raw response from Instapaper: {response.text}")

        token_data = dict(re.findall(r'(\w+)=([^&]+)', response.text))
        
        if 'oauth_token' in token_data and 'oauth_token_secret' in token_data:
            print("Successfully obtained Instapaper tokens.")
            if DEBUG_LOGGING:
                print(f"DEBUG: Obtained tokens: {token_data}")
            return token_data
        else:
            print("Failed to get tokens. Response format was not as expected.")
            if DEBUG_LOGGING:
                print("DEBUG: Final parsed token data:", token_data)
            return None

    except requests.exceptions.RequestException as e:
        print(f"Error obtaining Instapaper tokens: {e}")
        if 'response' in locals() and DEBUG_LOGGING:
            print(f"DEBUG: Instapaper API Response Text: {response.text}")
        return None
    except Exception as e:
        print(f"An unexpected error occurred while getting tokens: {e}")
        return None

def get_article_html_with_cookies(url, cookies):
    """
    Fetches the full HTML content of an article using authentication cookies.
    Returns the HTML content or None on failure.
    """
    if not cookies:
        if DEBUG_LOGGING:
            print("DEBUG: No cookies provided. Cannot fetch full article HTML.")
        return None

    if DEBUG_LOGGING:
        print(f"DEBUG: Attempting to fetch full article HTML from URL: {url}")
    
    session = requests.Session()
    for cookie in cookies:
        session.cookies.set(cookie['name'], cookie['value'])

    try:
        response = session.get(url, timeout=30)
        response.raise_for_status()
        if DEBUG_LOGGING:
            print(f"DEBUG: Successfully fetched article content from {url}.")
        return response.text
    except requests.exceptions.RequestException as e:
        print(f"Error fetching article content with cookies from {url}: {e}")
        if 'response' in locals() and DEBUG_LOGGING:
            print(f"DEBUG: HTTP status code: {response.status_code}")
            print(f"DEBUG: Response body: {response.text[:200]}...") # Print first 200 chars
        return None

def get_instapaper_folder_id(oauth_session, folder_name):
    """
    Checks if a folder with the given name exists and returns its ID.
    Returns the folder ID (str) or None if not found.
    """
    if DEBUG_LOGGING:
        print(f"DEBUG: Checking for existing folder: '{folder_name}'")
    try:
        response = oauth_session.post(INSTAPAPER_FOLDERS_LIST_URL)
        response.raise_for_status()
        
        folders = json.loads(response.text)
        
        for folder in folders:
            if folder.get('title') == folder_name:
                print(f"Found existing folder '{folder_name}' with ID: {folder['folder_id']}")
                return folder['folder_id']

    except Exception as e:
        print(f"Error listing Instapaper folders: {e}")
        if 'response' in locals() and DEBUG_LOGGING:
            print(f"DEBUG: Instapaper API Response Text: {response.text}")
    
    if DEBUG_LOGGING:
        print(f"DEBUG: Folder '{folder_name}' not found.")
    return None

def create_instapaper_folder(oauth_session, folder_name):
    """
    Creates a new folder with the given name and returns its ID.
    Returns the new folder ID (str) or None on failure.
    """
    if DEBUG_LOGGING:
        print(f"DEBUG: Creating new folder: '{folder_name}'")
    try:
        payload = {'title': folder_name}
        response = oauth_session.post(INSTAPAPER_FOLDERS_ADD_URL, data=payload)
        response.raise_for_status()
        
        new_folder = json.loads(response.text)
        new_id = new_folder[0].get('folder_id')
        if new_id:
            print(f"Successfully created new folder '{folder_name}' with ID: {new_id}")
            return new_id
        else:
            print(f"Failed to create folder. Response did not contain a folder ID.")
            if DEBUG_LOGGING:
                print(f"DEBUG: Instapaper API Response Text: {response.text}")
            return None

    except Exception as e:
        print(f"Error creating Instapaper folder: {e}")
        if 'response' in locals() and DEBUG_LOGGING:
            # Instapaper returns a 400 Bad Request if the folder already exists.
            # We can handle this as a success.
            if response.status_code == 400 and "Folder already exists" in response.text:
                print(f"Folder '{folder_name}' already exists. Handling as success.")
                return get_instapaper_folder_id(oauth_session, folder_name)
            print(f"DEBUG: Instapaper API Response Text: {response.text}")
        return None

def publish_to_instapaper(instapaper_config, url, title, raw_html_content, resolve_final_url=True, sanitize_content=False, tags_string='', folder_id=None):
    """
    Publishes a single article entry to Instapaper.
    `resolve_final_url`: Set to False to prevent Instapaper from resolving the URL.
    `sanitize_content`: Set to True to remove <img> tags before sending.
    `tags_string`: A comma-separated string of tags to add to the bookmark.
    `folder_id`: Optional. The integer folder ID for the destination folder.
    """
    try:
        consumer_key = instapaper_config.get('consumer_key')
        consumer_secret = instapaper_config.get('consumer_secret')
        oauth_token = instapaper_config.get('oauth_token')
        oauth_token_secret = instapaper_config.get('oauth_token_secret')
        
        if not all([consumer_key, consumer_secret, oauth_token, oauth_token_secret]):
            print("Incomplete Instapaper credentials. Cannot publish.")
            return

        # 1. Extract only the HTML body content
        body_match = re.search(r'<body.*?>(.*?)</body>', raw_html_content, re.DOTALL | re.I)
        processed_content = body_match.group(1) if body_match else raw_html_content
        
        # 2. Conditionally sanitize the content
        if sanitize_content:
            if DEBUG_LOGGING:
                print("DEBUG: Sanitizing content: Removing <img> tags.")
            processed_content = re.sub(r'<img[^>]+>', '', processed_content, flags=re.I)

        oauth = OAuth1Session(consumer_key,
                              client_secret=consumer_secret,
                              resource_owner_key=oauth_token,
                              resource_owner_secret=oauth_token_secret)

        payload = {
            'url': url,
            'title': title,
            'content': processed_content
        }
        
        # Explicitly set resolve_final_url to '0' if the config is false
        if not resolve_final_url:
            payload['resolve_final_url'] = '0'

        # Conditionally add tags if they are provided, formatted as a JSON string
        if tags_string:
            tags_list = [{'name': tag.strip()} for tag in tags_string.split(',') if tag.strip()]
            payload['tags'] = json.dumps(tags_list)
        
        # Conditionally add folder ID
        if folder_id:
            payload['folder_id'] = folder_id

        if DEBUG_LOGGING:
            print(f"DEBUG: Publishing URL: {url}")
            print(f"DEBUG: Publishing Title: {title}")
            print(f"DEBUG: Payload being sent to Instapaper API (content truncated): {payload['content'][:100]}...")
            if 'resolve_final_url' in payload:
                print(f"DEBUG: 'resolve_final_url' parameter is set to '0' to prevent URL resolution.")
            else:
                print(f"DEBUG: 'resolve_final_url' parameter is not explicitly set. Instapaper will resolve redirects.")
            if sanitize_content:
                print("DEBUG: Content sanitization is ENABLED.")
            else:
                print("DEBUG: Content sanitization is DISABLED.")
            if tags_string:
                print(f"DEBUG: Tags being added: '{tags_string}'.")
                print(f"DEBUG: Formatted tags being sent: '{payload['tags']}'.")
            if folder_id:
                print(f"DEBUG: Folder ID being used: '{folder_id}'.")

        # Use `data` parameter to send the payload as application/x-www-form-urlencoded
        response = oauth.post(INSTAPAPER_ADD_URL, data=payload)
        response.raise_for_status()
        
        print(f"Successfully published '{title}' to Instapaper.")
        if DEBUG_LOGGING:
            print(f"DEBUG: Instapaper API Response Status: {response.status_code}")
            print(f"DEBUG: Instapaper API Response Text: {response.text}")

    except Exception as e:
        print(f"Error publishing to Instapaper: {e}")
        if 'response' in locals() and DEBUG_LOGGING:
            print(f"DEBUG: Instapaper API Response Text: {response.text}")

def process_rss_and_publish(feed_url, instapaper_config, rss_feed_config, cookies, state):
    """
    Fetches the RSS feed from a given URL and publishes new entries to Instapaper.
    Accepts an optional `cookies` argument for authenticated content fetching.
    """
    
    # We no longer need to convert to a timestamp, as all state timestamps are datetime objects
    last_run_dt = state['last_rss_timestamp']
    
    if DEBUG_LOGGING:
        print(f"DEBUG: Last RSS entry timestamp from state: {last_run_dt.isoformat()}")

    try:
        print(f"\n--- Fetching RSS feed from {feed_url} ---")
        # Add a User-Agent header to mimic a browser
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/533.36'}
        feed_response = requests.get(feed_url, headers=headers, timeout=30)
        feed_response.raise_for_status()
        
        feed = feedparser.parse(feed_response.content)
        newest_timestamp_dt = last_run_dt
        published_count = 0
        
        resolve_final_url_flag = instapaper_config.getboolean('resolve_final_url', fallback=True)
        sanitize_content_flag = instapaper_config.getboolean('sanitize_content', fallback=False)
        tags_to_add = rss_feed_config.get('tags', '')
        folder_name = rss_feed_config.get('folder', '')
        
        # Initialize Instapaper folder_id if a folder is specified
        folder_id = None
        if folder_name:
            oauth_session = OAuth1Session(instapaper_config.get('consumer_key'),
                                          client_secret=instapaper_config.get('consumer_secret'),
                                          resource_owner_key=instapaper_config.get('oauth_token'),
                                          resource_owner_secret=instapaper_config.get('oauth_token_secret'))
            folder_id = get_instapaper_folder_id(oauth_session, folder_name)
            if not folder_id:
                folder_id = create_instapaper_folder(oauth_session, folder_name)

        if DEBUG_LOGGING:
            print(f"DEBUG: `resolve_final_url` setting is: {resolve_final_url_flag}")
            print(f"DEBUG: `sanitize_content` setting is: {sanitize_content_flag}")
            print(f"DEBUG: `tags` setting is: '{tags_to_add}'")
            if folder_name:
                print(f"DEBUG: `folder` setting is: '{folder_name}' with ID '{folder_id}'")

        if DEBUG_LOGGING:
            print(f"DEBUG: Found {len(feed.entries)} entries in the RSS feed.")

        for entry in reversed(feed.entries):
            entry_timestamp_dt = None
            if hasattr(entry, 'published_parsed'):
                entry_timestamp_dt = datetime.fromtimestamp(time.mktime(entry.published_parsed))
            elif hasattr(entry, 'updated_parsed'):
                entry_timestamp_dt = datetime.fromtimestamp(time.mktime(entry.updated_parsed))
            
            if DEBUG_LOGGING:
                print(f"DEBUG: Processing entry '{entry.title}'. Timestamp: {entry_timestamp_dt}")

            if entry_timestamp_dt and entry_timestamp_dt > state['last_rss_timestamp']:
                url = entry.link
                title = entry.title
                
                # Use cookies to fetch full article content if available
                raw_html_content = None
                if cookies:
                    raw_html_content = get_article_html_with_cookies(url, cookies)
                
                # Fallback to RSS content if full content is not available
                if not raw_html_content:
                    raw_html_content = entry.get('content', [{}])[0].get('value', '') or entry.get('summary', '') or entry.get('description', '')
                    if DEBUG_LOGGING:
                        print("DEBUG: Using RSS entry content as fallback.")
                
                print(f"Found new entry: '{title}' from {entry_timestamp_dt.isoformat()}")
                if DEBUG_LOGGING:
                    print(f"DEBUG: Article URL to be sent to Instapaper: {url}")
                publish_to_instapaper(
                    instapaper_config, 
                    url, 
                    title, 
                    raw_html_content, 
                    resolve_final_url=resolve_final_url_flag,
                    sanitize_content=sanitize_content_flag,
                    tags_string=tags_to_add,
                    folder_id=folder_id
                )
                published_count += 1
                
                if entry_timestamp_dt > newest_timestamp_dt:
                    newest_timestamp_dt = entry_timestamp_dt

        if published_count > 0:
            print(f"Finished processing. Published {published_count} new entries to Instapaper.")
            state['last_rss_timestamp'] = newest_timestamp_dt
            print(f"State updated with newest RSS entry timestamp: {newest_timestamp_dt.isoformat()}")
        else:
            print("No new entries found to publish.")
    
    except requests.exceptions.RequestException as e:
        print(f"\nError fetching RSS feed: {e}")
        if DEBUG_LOGGING and 'response' in locals():
            print(f"DEBUG: HTTP status code: {feed_response.status_code}")
            print(f"DEBUG: HTTP response body: {feed_response.text}")
    except Exception as e:
        print(f"\nAn unexpected error occurred while processing feed: {e}")


def login_and_update(config_name, email, password, miniflux_config, site_config):
    """
    Performs login and returns captured cookies.
    Returns: a list of cookie dictionaries, or an empty list on failure.
    """
    login_type = site_config.get('login_type')
    cookies = []

    print(f"\n--- Running {site_config.get('site_name')} login for: {config_name} using {login_type} method ---")
    if DEBUG_LOGGING:
        print(f"DEBUG: Login URL: {site_config.get('login_url')}")

    if login_type == "selenium":
        driver = None
        try:
            if DEBUG_LOGGING:
                print("DEBUG: Initializing WebDriver with headless mode.")
            driver = webdriver.Chrome(service=service, options=options)
            driver.get(site_config.get('login_url'))
            print(f"Navigated to {site_config.get('login_url')}")

            wait = WebDriverWait(driver, 20)
            required_cookies_str = site_config.get('required_cookies', '')
            if required_cookies_str:
                required_cookies = [c.strip() for c in required_cookies_str.split(',')]
                if DEBUG_LOGGING:
                    print(f"DEBUG: Waiting for required cookies: {required_cookies}")
                for cookie in required_cookies:
                    wait.until(lambda d: cookie in [c['name'] for c in d.get_cookies()])
                    if DEBUG_LOGGING:
                        print(f"DEBUG: Found required cookie '{cookie}'.")
            else:
                if DEBUG_LOGGING:
                    print("DEBUG: No specific cookies to wait for.")
                time.sleep(2)

            email_field = wait.until(EC.visibility_of_element_located((By.ID, site_config.get('email_field_id'))))
            email_field.send_keys(email)
            if DEBUG_LOGGING:
                print(f"DEBUG: Email field filled (ID: {site_config.get('email_field_id')}).")

            password_field = wait.until(EC.visibility_of_element_located((By.ID, site_config.get('password_field_id'))))
            password_field.send_keys(password)
            if DEBUG_LOGGING:
                print(f"DEBUG: Password field filled (ID: {site_config.get('password_field_id')}).")

            signin_button = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, site_config.get('login_button_selector'))))
            signin_button.click()
            print("Login button clicked successfully.")
            if DEBUG_LOGGING:
                print(f"DEBUG: Login button clicked (Selector: {site_config.get('login_button_selector')}).")

            success_text = site_config.get('expected_success_text')
            success_locator_class = site_config.get('success_text_class')
            
            if success_text and success_locator_class:
                welcome_element = wait.until(EC.visibility_of_element_located((By.CLASS_NAME, success_locator_class)))
                assert welcome_element.text.strip() == success_text.strip(), "Login verification failed: Welcome message not found or text mismatch."
                print("Login successful and welcome message verified.")
                if DEBUG_LOGGING:
                    print(f"DEBUG: Verified success text: '{success_text}'")
            else:
                print("No success text or locator provided. Assuming login was successful.")
                time.sleep(5)

            if ENABLE_SCREENSHOTS:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                success_screenshot_path = os.path.join(log_dir, f"{site_config.get('site_name')}_success_screenshot_{config_name}_{timestamp}.png")
                driver.save_screenshot(success_screenshot_path)
                print(f"Screenshot of successful login saved to {success_screenshot_path}")

            cookies = driver.get_cookies()
            if DEBUG_LOGGING:
                print(f"DEBUG: Captured {len(cookies)} cookies.")
            update_miniflux_feed_with_cookies(miniflux_config, cookies, config_name)
            return cookies

        except (WebDriverException, TimeoutException, AssertionError, Exception) as e:
            print(f"\n--- Script Failed ---\nAn error occurred during {site_config.get('site_name')} login for {config_name}: {e}")
            if driver and ENABLE_SCREENSHOTS:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                failure_screenshot_path = os.path.join(log_dir, f"{site_config.get('site_name')}_failure_screenshot_{config_name}_{timestamp}.png")
                driver.save_screenshot(failure_screenshot_path)
            return []
        finally:
            if driver:
                if DEBUG_LOGGING:
                    try:
                        print("\n--- Browser Cookies After Session ---")
                        print(json.dumps(driver.get_cookies(), indent=2))
                        print("\n--- Browser Logs ---")
                        for entry in driver.get_log('browser'):
                            print(entry)
                    except WebDriverException as e:
                        print(f"Failed to retrieve logs/cookies: {e}")
                print("\nQuitting WebDriver.")
                driver.quit()

    elif login_type == "api":
        headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/533.36'
        }
        data = {
            'email': email,
            'password': password,
            'captcha_response': 'None'
        }
        if DEBUG_LOGGING:
            print(f"DEBUG: API Login URL: {site_config.get('login_url')}")
            print(f"DEBUG: API Payload: {data}")

        try:
            if DEBUG_LOGGING:
                print("DEBUG: Sending POST request to API...")
            response = requests.post(site_config.get('login_url'), headers=headers, data=data, timeout=30)
            response.raise_for_status()

            print("API login successful.")
            if DEBUG_LOGGING:
                print(f"DEBUG: Response status: {response.status_code}")
                print(f"DEBUG: Response headers: {response.headers}")

            cookies_jar = response.cookies
            cookies = [{'name': c.name, 'value': c.value} for c in cookies_jar]
            if DEBUG_LOGGING:
                print(f"DEBUG: Captured {len(cookies)} cookies.")

            update_miniflux_feed_with_cookies(miniflux_config, cookies, config_name)
            return cookies

        except requests.exceptions.RequestException as e:
            print(f"\n--- Script Failed ---\nAn error occurred during API login for {config_name}: {e}")
            if 'response' in locals() and DEBUG_LOGGING:
                print(f"DEBUG: Response text: {response.text}")
            return []
        except Exception as e:
            print(f"\n--- Script Failed ---\nAn unexpected error occurred during API login for {config_name}: {e}")
            return []

    else:
        print(f"Unsupported login_type '{login_type}' defined in config. Skipping.")
        return []

def get_config_files(path):
    """Parses the command-line argument to return a list of INI files."""
    if os.path.isfile(path) and path.endswith('.ini'):
        return [path]
    elif os.path.isdir(path):
        return glob(os.path.join(path, '*.ini'))
    else:
        print("Error: Invalid path provided. Please specify a .ini file or a directory containing .ini files.")
        sys.exit(1)

def run_service(config_path):
    """The main service loop that processes configs continuously."""
    config_files = get_config_files(config_path)
    
    # Load initial state from .ctrl files for all configs
    last_run_times = {
        os.path.basename(f): load_state(f) for f in config_files
    }
    
    # Add a cookies key to each state entry
    for key in last_run_times:
        last_run_times[key]['cookies'] = []

    while True:
        print(f"\n[{datetime.now()}] --- Starting a new service poll loop ---")
        
        for config_file in config_files:
            config = configparser.ConfigParser()
            try:
                config.read(config_file)
                config_name = os.path.basename(config_file)
                state = last_run_times[config_name]
                
                # --- Handle Login & Miniflux Cookie Update (if configured) ---
                if 'SITE_CONFIG' in config and 'LOGIN_CREDENTIALS' in config and 'MINIFLUX_API' in config:
                    site_config = config['SITE_CONFIG']
                    login_credentials = config['LOGIN_CREDENTIALS']
                    miniflux_config = config['MINIFLUX_API']
                    
                    email = login_credentials.get('email')
                    password = login_credentials.get('password')
                    refresh_frequency_str = miniflux_config.get('refresh_frequency')
                    
                    if not all([email, password, refresh_frequency_str]):
                        print(f"Skipping login for {config_name}: incomplete credentials or refresh_frequency is missing.")
                    else:
                        refresh_frequency_sec = parse_frequency_to_seconds(refresh_frequency_str)
                        time_since_last_run = datetime.now() - state['last_miniflux_refresh_time']

                        if time_since_last_run.total_seconds() >= refresh_frequency_sec:
                            print(f"\n--- Running scheduled login for {config_name} ---")
                            cookies = login_and_update(config_name, email, password, miniflux_config, site_config)
                            state['cookies'] = cookies
                            state['last_miniflux_refresh_time'] = datetime.now()
                            save_state(config_file, state)
                        else:
                            print(f"\n--- Skipping login for {config_name}: Not yet time to refresh. ---")

                # --- Handle RSS to Instapaper Publishing (if configured) ---
                if 'INSTAPAPER_API' in config and 'RSS_FEED_CONFIG' in config:
                    instapaper_config = config['INSTAPAPER_API']
                    rss_feed_config = config['RSS_FEED_CONFIG']
                    feed_url = rss_feed_config.get('feed_url')
                    poll_frequency_str = rss_feed_config.get('poll_frequency', '1h')
                    
                    if not feed_url:
                        print(f"Skipping RSS to Instapaper for {config_name}: 'feed_url' is missing.")
                    else:
                        poll_frequency_sec = parse_frequency_to_seconds(poll_frequency_str)
                        time_since_last_poll = datetime.now() - state['last_rss_poll_time']

                        if time_since_last_poll.total_seconds() >= poll_frequency_sec:
                            print(f"\n--- Running scheduled RSS poll for {config_name} ---")
                            process_rss_and_publish(feed_url, instapaper_config, rss_feed_config, state['cookies'], state)
                            state['last_rss_poll_time'] = datetime.now()
                            save_state(config_file, state)
                        else:
                            print(f"\n--- Skipping RSS poll for {config_name}: Not yet time to poll. ---")

            except (configparser.Error, KeyError) as e:
                print(f"\nError reading or parsing INI file {config_file}: {e}")
                continue

        # Sleep for a minute before the next loop iteration to prevent a busy loop.
        print(f"\n[{datetime.now()}] --- Service poll loop finished. Sleeping for 60 seconds. ---")
        time.sleep(60)

def main():
    """Main function to parse arguments and start the service loop."""
    parser = argparse.ArgumentParser(description="Run RSS to Instapaper bridge as a continuous service.")
    parser.add_argument("config_path", help="Path to a specific .ini file or a directory containing .ini files.")
    args = parser.parse_args()

    # Initial check for Instapaper OAuth tokens before starting the service loop
    print("Performing initial check for Instapaper OAuth tokens...")
    config_files = get_config_files(args.config_path)
    for config_file in config_files:
        config = configparser.ConfigParser()
        config.read(config_file)
        if 'INSTAPAPER_OAUTH' in config:
            print(f"Found 'INSTAPAPER_OAUTH' section in {os.path.basename(config_file)}. Attempting to generate tokens...")
            oauth_credentials = config['INSTAPAPER_OAUTH']
            consumer_key = oauth_credentials.get('consumer_key')
            consumer_secret = oauth_credentials.get('consumer_secret')
            username = oauth_credentials.get('username')
            password = oauth_credentials.get('password')
            
            if all([consumer_key, consumer_secret, username, password]):
                tokens = get_instapaper_tokens(consumer_key, consumer_secret, username, password)
                if tokens:
                    if 'INSTAPAPER_API' not in config:
                        config['INSTAPAPER_API'] = {}
                    config['INSTAPAPER_API']['oauth_token'] = tokens['oauth_token']
                    config['INSTAPAPER_API']['oauth_token_secret'] = tokens['oauth_token_secret']
                    config['INSTAPAPER_API']['consumer_key'] = consumer_key
                    config['INSTAPAPER_API']['consumer_secret'] = consumer_secret
                    config.remove_section('INSTAPAPER_OAUTH')
                    with open(config_file, 'w') as f:
                        config.write(f)
                    print(f"Successfully wrote Instapaper tokens to {os.path.basename(config_file)}.")
                else:
                    print(f"Failed to generate Instapaper tokens for {os.path.basename(config_file)}. Please check credentials.")
            else:
                print(f"Skipping token generation for {os.path.basename(config_file)}: Incomplete credentials.")
    
    print("\nStarting the continuous service loop...")
    run_service(args.config_path)

if __name__ == "__main__":
    main()