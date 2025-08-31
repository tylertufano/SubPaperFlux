import os
import sys
import argparse
import configparser
import json
import time
from datetime import datetime
from glob import glob
import requests
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import WebDriverException, TimeoutException

# --- Configure Execution Based on Environment Variables ---
DEBUG_LOGGING = os.getenv('DEBUG_LOGGING', '0').lower() in ('1', 'true')
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

service = Service(ChromeDriverManager().install(), log_output=service_log_path)

# Constants for target URLs and text
DD_LOGIN_URL = "https://member.democracydocket.com/_hcms/mem/login"
DD_EXPECTED_WELCOME_TEXT = "Welcome to the members-only section of our website, a home for pro-democracy readers to find the news, ideas and resources needed to fight back."
SUBSTACK_LOGIN_API = "https://substack.com/api/v1/login"

def update_miniflux_feed_with_cookies(miniflux_config, cookies):
    """
    Updates all specified Miniflux feeds with captured cookies.
    This is the common function for updating miniflux feeds.
    """
    if miniflux_config:
        miniflux_url = miniflux_config.get('miniflux_url')
        api_key = miniflux_config.get('api_key')
        feed_ids_str = miniflux_config.get('feed_ids')
        if feed_ids_str:
            feed_ids = [int(fid.strip()) for fid in feed_ids_str.split(',')]
            for feed_id in feed_ids:
                print(f"\n--- Updating Miniflux Feed {feed_id} ---")
                
                api_endpoint = f"{miniflux_url}/v1/feeds/{feed_id}"
                headers = {
                    "X-Auth-Token": api_key,
                    "Content-Type": "application/json",
                }
                
                cookie_str = "; ".join([f"{c['name']}={c['value']}" for c in cookies])
                
                payload = {
                    "cookie": cookie_str,
                }
                
                try:
                    response = requests.put(api_endpoint, headers=headers, json=payload)
                    response.raise_for_status()
                    print(f"Miniflux feed {feed_id} updated successfully with new cookies.")
                    if DEBUG_LOGGING:
                        print("Response:", response.json())
                except requests.exceptions.RequestException as e:
                    print(f"Error updating Miniflux feed {feed_id}: {e}")
                    if DEBUG_LOGGING:
                        print("Response text:", response.text if 'response' in locals() else 'No response')

def democracy_docket_login(email, password, config_source, miniflux_config):
    """Automates login for Democracy Docket using Selenium."""
    driver = None
    try:
        print(f"\n--- Running Democracy Docket login for: {config_source} ---")
        if DEBUG_LOGGING:
            print("Running in DEBUG mode.")
        
        print("Initializing WebDriver...")
        driver = webdriver.Chrome(service=service, options=options)
        driver.get(DD_LOGIN_URL)
        print(f"Navigated to {DD_LOGIN_URL}")

        wait = WebDriverWait(driver, 20)

        if DEBUG_LOGGING:
            print("Waiting for CSRF cookie 'hs-membership-csrf'...")
        wait.until(lambda d: "hs-membership-csrf" in [c['name'] for c in d.get_cookies()])
        if DEBUG_LOGGING:
            print("CSRF cookie found.")
        
        time.sleep(2) 

        email_field = wait.until(EC.visibility_of_element_located((By.ID, "hs-login-widget-email")))
        email_field.send_keys(email)
        if DEBUG_LOGGING:
            print(f"Email field filled with: {email}")

        password_field = wait.until(EC.visibility_of_element_located((By.ID, "hs-login-widget-password")))
        password_field.send_keys(password)
        if DEBUG_LOGGING:
            print("Password field filled.")

        signin_button = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, "input[type='submit'][value='Login']")))
        signin_button.click()
        print("Login button clicked successfully.")

        welcome_message_locator = (By.CLASS_NAME, "gb-module-blog-header-1-description")
        welcome_element = wait.until(EC.visibility_of_element_located(welcome_message_locator))

        assert welcome_element.text.strip() == DD_EXPECTED_WELCOME_TEXT.strip(), "Login verification failed: Welcome message not found or text mismatch."

        print("Login successful and welcome message verified.")

        if ENABLE_SCREENSHOTS:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            success_screenshot_path = os.path.join(log_dir, f"dd_success_screenshot_{config_source}_{timestamp}.png")
            driver.save_screenshot(success_screenshot_path)
            print(f"Screenshot of successful login saved to {success_screenshot_path}")

        cookies = driver.get_cookies()
        update_miniflux_feed_with_cookies(miniflux_config, cookies)

    except (WebDriverException, TimeoutException, AssertionError, Exception) as e:
        print(f"\n--- Script Failed ---\nAn error occurred during DD login for {config_source}: {e}")
        if driver and ENABLE_SCREENSHOTS:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            failure_screenshot_path = os.path.join(log_dir, f"dd_failure_screenshot_{config_source}_{timestamp}.png")
            driver.save_screenshot(failure_screenshot_path)
            print(f"Screenshot of failure saved to {failure_screenshot_path}")
    finally:
        if driver:
            if DEBUG_LOGGING:
                try:
                    cookies = driver.get_cookies()
                    print("\n--- DD Browser Cookies After Session ---")
                    print(json.dumps(cookies, indent=2))
                except WebDriverException as e:
                    print(f"Failed to retrieve cookies: {e}")

                print("\n--- DD Browser Logs ---")
                for entry in driver.get_log('browser'):
                    print(entry)

            print("\nQuitting WebDriver.")
            driver.quit()


def substack_login(email, password, config_source, miniflux_config):
    """Automates login for Substack using the unofficial API."""
    print(f"\n--- Running Substack login for: {config_source} ---")
    
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
    }
    
    data = {
        'email': email,
        'password': password,
        'captcha_response': 'None'
    }

    try:
        if DEBUG_LOGGING:
            print("Sending POST request to Substack API...")
        
        response = requests.post(SUBSTACK_LOGIN_API, headers=headers, data=data, timeout=30)
        response.raise_for_status()
        
        print("Substack login successful.")
        if DEBUG_LOGGING:
            print("Substack login response status:", response.status_code)
            print("Substack login response headers:", response.headers)
            
        cookies_jar = response.cookies
        cookies = [{'name': c.name, 'value': c.value} for c in cookies_jar]
        
        update_miniflux_feed_with_cookies(miniflux_config, cookies)
            
        if ENABLE_SCREENSHOTS:
            print("Screenshot functionality not available for API login.")

    except requests.exceptions.RequestException as e:
        print(f"\n--- Script Failed ---\nAn error occurred during Substack API login for {config_source}: {e}")
        if DEBUG_LOGGING:
            print("Response text:", response.text if 'response' in locals() else 'No response')
    except Exception as e:
        print(f"\n--- Script Failed ---\nAn unexpected error occurred during Substack login for {config_source}: {e}")


def get_config_files(path):
    """Parses the command-line argument to return a list of INI files."""
    if os.path.isfile(path) and path.endswith('.ini'):
        return [path]
    elif os.path.isdir(path):
        return glob(os.path.join(path, '*.ini'))
    else:
        print("Error: Invalid path provided. Please specify a .ini file or a directory containing .ini files.")
        sys.exit(1)


def main():
    """Main function to parse arguments and run the login process."""
    parser = argparse.ArgumentParser(description="Automate login using credentials from INI file(s).")
    parser.add_argument("config_path", help="Path to a specific .ini file or a directory containing .ini files.")
    args = parser.parse_args()

    config_files = get_config_files(args.config_path)

    for config_file in config_files:
        config = configparser.ConfigParser()
        try:
            config.read(config_file)
            config_source = os.path.basename(config_file)
            
            miniflux_config = config['MINIFLUX_API'] if 'MINIFLUX_API' in config else None

            if 'SUBSTACK_CREDENTIALS' in config:
                email = config['SUBSTACK_CREDENTIALS']['email']
                password = config['SUBSTACK_CREDENTIALS']['password']
                substack_login(email, password, config_source, miniflux_config)
            elif 'LOGIN_CREDENTIALS' in config:
                email = config['LOGIN_CREDENTIALS']['email']
                password = config['LOGIN_CREDENTIALS']['password']
                democracy_docket_login(email, password, config_source, miniflux_config)
            else:
                print(f"No login credentials found in {config_file}. Skipping.")

        except (configparser.Error, KeyError) as e:
            print(f"\nError reading or parsing INI file {config_file}: {e}")
            continue

if __name__ == "__main__":
    main()
