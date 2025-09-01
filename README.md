# python-script-scheduler

### Template 1: For a Selenium-based login (e.g., Democracy Docket)

This template is for websites that require a browser to perform the login action, typically involving navigating through a web form.

```ini
[SITE_CONFIG]
site_name = Democracy Docket
login_type = selenium
login_url = https://member.democracydocket.com/_hcms/mem/login
email_field_id = hs-login-widget-email
password_field_id = hs-login-widget-password
login_button_selector = input[type='submit'][value='Login']
success_text_class = gb-module-blog-header-1-description
expected_success_text = Welcome to the members-only section of our website, a home for pro-democracy readers to find the news, ideas and resources needed to fight back.
required_cookies = hs-membership-csrf

[LOGIN_CREDENTIALS]
email = your_democracy_docket_email@example.com
password = your_dd_password

[MINIFLUX_API]
miniflux_url = http://your_miniflux_instance:8080
api_key = your_miniflux_api_key
feed_ids = 1, 2, 3
```

### Template 2: For an API-based login (e.g., Substack)

This template is for websites where login can be accomplished by sending a request directly to a login API endpoint.

```ini
[SITE_CONFIG]
site_name = Substack
login_type = api
login_url = https://substack.com/api/v1/login

[LOGIN_CREDENTIALS]
email = your_substack_email@example.com
password = your_substack_password

[MINIFLUX_API]
miniflux_url = http://your_miniflux_instance:8080
api_key = your_miniflux_api_key
feed_ids = 4, 5
```

### Explanation of Sections:

  * **`[SITE_CONFIG]`**:

      * `site_name`: A user-friendly name for the website. Used in log messages.
      * `login_type`: Must be either `selenium` or `api`.
      * `login_url`: The URL for the login page (for `selenium`) or the API endpoint (for `api`).
      * `email_field_id`: (Selenium only) The HTML `id` attribute of the email input field.
      * `password_field_id`: (Selenium only) The HTML `id` attribute of the password input field.
      * `login_button_selector`: (Selenium only) The CSS selector for the login button.
      * `success_text_class`: (Selenium only) The HTML `class` attribute of an element that confirms successful login.
      * `expected_success_text`: (Selenium only) The exact text content of the success element to verify the login.
      * `required_cookies`: (Selenium only, optional) A comma-separated list of cookie names to wait for before proceeding.

  * **`[LOGIN_CREDENTIALS]`**:

      * `email`: The email address for the account.
      * `password`: The password for the account.

  * **`[MINIFLUX_API]`**:

      * `miniflux_url`: The base URL of your Miniflux instance.
      * `api_key`: Your personal API key from Miniflux.
      * `feed_ids`: A comma-separated list of integer feed IDs to update with the new cookies.