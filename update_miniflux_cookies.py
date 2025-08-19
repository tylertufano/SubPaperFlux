import os
import requests
import argparse
import configparser

def login_and_get_cookies(config):
    login_url = config['Login']['login_url']
    payload = {
        'email': config['Login']['login_user'],  # Note the change here
        'password': config['Login']['password']
    }

    with requests.Session() as session:
        response = session.post(login_url, data=payload)
        if "incorrect" in response.text.lower():
            print("Login failed.")
            return None
        return session.cookies.get_dict()

def update_miniflux_feed(config, cookies):
    cookies_str = "; ".join([f"{key}={value}" for key, value in cookies.items()])
    api_url = f"{config['Miniflux']['api_url']}/feeds/{config['Feed']['feed_id']}"
    
    headers = {
        'X-Auth-Token': config['Miniflux']['api_key'],
        'Content-Type': 'application/json'
    }
    
    data = {'scraper_rules': cookies_str}
    
    response = requests.put(api_url, json=data, headers=headers)
    if response.status_code == 200:
        print("Feed updated successfully.")
    else:
        print("Failed to update feed:", response.text)

def process_config_file(config_file):
    print(f"Processing {config_file}")
    parser = configparser.ConfigParser()
    parser.read(config_file)
    config = {section: dict(parser.items(section)) for section in parser.sections()}
    
    cookies = login_and_get_cookies(config)
    if cookies:
        update_miniflux_feed(config, cookies)
    else:
        print("Failed to retrieve cookies.")

def main(input_path):
    if os.path.isdir(input_path):
        for filename in os.listdir(input_path):
            if filename.endswith('.ini'):
                config_file = os.path.join(input_path, filename)
                process_config_file(config_file)
    elif os.path.isfile(input_path) and input_path.endswith('.ini'):
        process_config_file(input_path)
    else:
        print("Invalid file or directory path. Please provide a valid .ini file or a directory containing .ini files.")

if __name__ == "__main__":
    arg_parser = argparse.ArgumentParser(description="Login to website and update Miniflux feed cookies via API.")
    arg_parser.add_argument('input_path', type=str, help="Path to the configuration .ini file or directory containing .ini files")
    args = arg_parser.parse_args()
    
    main(args.input_path)