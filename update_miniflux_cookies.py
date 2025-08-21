import os
import requests
import argparse
from configparser import ConfigParser
from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from webdriver_manager.chrome import ChromeDriverManager
import time

def setup_driver():
    """ Sets up the Chrome WebDriver. """
    return webdriver.Chrome(ChromeDriverManager().install())

def login_substack(driver, credentials):
    """ Logs into Substack using given credentials. """
    driver.get(credentials['login_url'])
    time.sleep(2)
    email_field = driver.find_element("name", "email")  # Update with actual identifier
    password_field = driver.find_element("name", "password")  # Update with actual identifier
    email_field.send_keys(credentials['username'])
    password_field.send_keys(credentials['password'])
    password_field.send_keys(Keys.RETURN)
    time.sleep(2)

def login_democracy_docket(driver, credentials):
    """ Logs into Democracy Docket using given credentials. """
    driver.get(credentials['login_url'])
    time.sleep(2)
    email_field = driver.find_element("name", "email")  # Update with actual identifier
    password_field = driver.find_element("name", "password")  # Update with actual identifier
    email_field.send_keys(credentials['username'])
    password_field.send_keys(credentials['password'])
    password_field.send_keys(Keys.RETURN)
    time.sleep(2)

def perform_login(credentials):
    """ Determines the platform and executes respective login procedure. """
    driver = setup_driver()
    try:
        if credentials['platform'].lower() == 'substack':
            login_substack(driver, credentials)
        elif credentials['platform'].lower() == 'democracydocket':
            login_democracy_docket(driver, credentials)
        else:
            raise ValueError(f"Unsupported platform: {credentials['platform']}")
    finally:
        driver.quit()

def fetch_cookies_from_driver(driver):
    selenium_cookies = driver.get_cookies()
    session = requests.Session()
    for cookie in selenium_cookies:
        session.cookies.set(cookie['name'], cookie['value'])
    return session.cookies.get_dict()

def update_miniflux_feed(miniflux, cookies):
    """ Updates the Miniflux feed with the captured cookies. """
    api_url = f"{miniflux['api_url']}/feeds/{miniflux['feed_id']}"
    headers = {'X-Auth-Token': miniflux['api_key'], 'Content-Type': 'application/json'}
    data = {'scraper_rules': '; '.join([f"{c}={cookies[c]}" for c in cookies])}
    response = requests.put(api_url, json=data, headers=headers)
    if response.status_code == 200:
        print("Feed updated successfully.")
    else:
        print(f"Failed to update feed: {response.text}")

def process_config_file(config_file):
    print(f"Processing {config_file}")
    config = ConfigParser()
    config.read(config_file)
    credentials = dict(config.items('Credentials'))
    miniflux = dict(config.items('Miniflux'))
    session_cookies = perform_login(credentials)
    update_miniflux_feed(miniflux, session_cookies)

def main(input_path):
    if os.path.isdir(input_path):
        for filename in os.listdir(input_path):
            if filename.endswith('.ini'):
                process_config_file(os.path.join(input_path, filename))
    elif os.path.isfile(input_path) and input_path.endswith('.ini'):
        process_config_file(input_path)
    else:
        print("Invalid file or directory path.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Process config files for web login and update Miniflux.")
    parser.add_argument('input_path', type=str, help="Path to the .ini file or directory of .ini files")
    args = parser.parse_args()
    main(args.input_path)