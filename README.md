# SubPaperFlux

SubPaperFlux continuously bridges RSS feeds and Instapaper, with optional paywall-aware fetching and Miniflux cookie updates. It can log in to sites via headless Chrome to capture authentication cookies, push those cookies to Miniflux feeds, poll RSS for new entries (storing them locally as bookmarks), and publish them to Instapaper. It maintains lightweight state per configuration so it can run as a long‑lived service.

The standalone script has been replaced by a FastAPI backend (`app.main`) and a background worker (`app.worker`) that share a common database. This repository also ships a Next.js UI, Docker assets, and example configuration formats so the API-first service can be deployed alongside the worker.

**Key Features**
- Headless logins: Uses Selenium + Chrome to authenticate and capture cookies.
- Miniflux integration: Updates specified Miniflux feeds with fresh cookies.
- RSS polling: Fetches and filters feed entries using flexible schedules and lookbacks.
- Instapaper publishing: Consumes stored bookmarks and sends URLs or full HTML (for paywalled content) to Instapaper, with folder and tag support.
- Stateful operation: Tracks last poll time, last processed entry, and a local bookmark cache for sync/purge.
- Retention and purge: Optional retention to delete old Instapaper bookmarks.

**How It Works**
- You provide an INI file per feed with references to JSON config blocks.
- On a schedule, the service optionally logs in (headless), updates Miniflux cookies, polls the RSS feed (saving matching entries as bookmarks), then publishes new items to Instapaper.
- State is stored per INI as a `.ctrl` file next to your INI; cookies are cached in a database-backed store keyed by the `site_login_id`/`site_config_id` pair from your config.

Requirements
- Python 3.11+ (Docker image uses Python 3.12 slim).
- Google Chrome available (the Docker image installs `google-chrome-stable`).
- Instapaper app credentials (consumer key/secret) and an Instapaper login that the web UI can exchange for long-lived tokens.

Configuration Overview
- SubPaperFlux now persists configuration data (credentials, site configs, feeds) in Postgres via the API and web UI. The schemas below document the legacy file formats to help operators migrating existing `.ini`/`.json` assets into the database-driven model.
- Put all configuration files in one directory and point the service to either a single `.ini` in that directory or the whole directory.
- The service expects these files:
  - `credentials.json`: IDs and secrets for logins, Instapaper, and Miniflux. Instapaper entries should start with placeholders; complete the onboarding flow in the UI to exchange the username/password for tokens and persist them.
  - `site_configs.json`: Site‑specific login selectors and cookie names.
  - `instapaper_app_creds.json`: Instapaper app consumer key/secret.
  - Database-backed cookie store: Automatically managed cache of cookies bound to the site login/site config pair (created/updated by the service).
  - `your_feed.ini`: One or more INI files describing each feed.
  - `your_feed.ctrl`: Automatically managed state file per INI (created/updated by the service).

JSON Files
- `instapaper_app_creds.json`
  - consumer_key: Your Instapaper application consumer key.
  - consumer_secret: Your Instapaper application consumer secret.

- `credentials.json` (dictionary keyed by your IDs)
  - For a login identity (referenced by `login_id`):
    - username: Site login username/email.
    - password: Site login password.
  - For Instapaper credentials (referenced by `instapaper_id`):
    - oauth_token / oauth_token_secret: Filled in automatically after you create the credential through the UI's Instapaper onboarding (description + username/password exchange).
  - For Miniflux (referenced by `miniflux_id`):
    - miniflux_url: Base URL of your Miniflux instance.
    - api_key: Personal Miniflux API token.

  Example structure:
  ```json
  {
    "my_login": { "username": "user@example.com", "password": "secret" },
    "my_instapaper": { "oauth_token": "<set via UI onboarding>", "oauth_token_secret": "<set via UI onboarding>" },
    "my_miniflux": { "miniflux_url": "http://miniflux:8080", "api_key": "..." }
  }
  ```

- `site_configs.json` (dictionary keyed by your `site_config_id`)
  - `name`: Friendly label that appears in the dashboard.
  - `site_url`: Base URL for the site or application.
  - `login_type`: One of `selenium` or `api`. This flag controls which nested payload is validated and executed during logins.
  - For `login_type = "selenium"`, provide a `selenium_config` object containing:
    - `username_selector`: CSS selector for the username input.
    - `password_selector`: CSS selector for the password input.
    - `login_button_selector`: CSS selector for the submit button.
    - `post_login_selector`: Optional selector the worker waits for after submitting the form. This extra check only runs for Selenium logins.
    - `cookies_to_store`: Array of cookie names to persist. Omit or set to an empty array to capture every cookie returned by the browser session.
  - For `login_type = "api"`, provide an `api_config` object containing:
    - `endpoint`: Absolute URL that receives the login request.
    - `method`: HTTP method to call (`GET`, `POST`, `PUT`, `PATCH`, or `DELETE`).
    - `headers`: Optional object of static or templated request headers.
    - `body`: Optional JSON object sent as the request body. Values can include `{{username}}` and `{{password}}` placeholders that the worker replaces with the credential at runtime.
    - `cookies_to_store`: Optional list of cookie names to capture directly from the HTTP response. If omitted, the worker falls back to the keys provided in `cookies`.
    - `cookies`: Optional object describing which cookies to keep from the response. Keys are the names you want to persist; values describe how to extract them (for example a response cookie key or JSON pointer).
    - `pre_login`: Optional single object or array of objects shaped like `endpoint`/`method`/`headers`/`body`. These requests run before the main login call and are useful for CSRF token priming.

  Example:

  ```json
  {
    "selenium_site": {
      "name": "Example News Login",
      "site_url": "https://example.com/login",
      "login_type": "selenium",
      "selenium_config": {
        "username_selector": "#username",
        "password_selector": "#password",
        "login_button_selector": "button[type='submit']",
        "post_login_selector": "nav .user-avatar",
        "cookies_to_store": ["sessionid", "csrftoken"]
      }
    },
    "api_site": {
      "name": "Example API Login",
      "site_url": "https://example.com/app",
      "login_type": "api",
      "api_config": {
        "endpoint": "https://example.com/api/v1/login",
        "method": "POST",
        "headers": {
          "Content-Type": "application/json"
        },
        "body": {
          "username": "{{username}}",
          "password": "{{password}}"
        },
        "cookies_to_store": ["sessionid"],
        "cookies": {
          "sessionid": "$.data.session.id"
        }
      }
    }
  }
  ```

  The worker logs the selected login path (`selenium` or `api`) so it is easy to trace which flow executed during troubleshooting.

INI Files
- Each feed is defined by an INI with the sections below:

  ```ini
  [CONFIG_REFERENCES]
  login_id = my_login                  ; optional unless paywalled/auth RSS
  site_config_id = my_site             ; optional unless paywalled/auth RSS
  instapaper_id = my_instapaper        ; required for publishing
  miniflux_id = my_miniflux            ; optional, used for cookie updates

  [RSS_FEED_CONFIG]
  feed_url = https://example.com/feed.xml
  poll_frequency = 1h                  ; default 1h
  initial_lookback_period = 24h        ; only on first run
  is_paywalled = false                 ; if true, the worker can fetch HTML with cookies
  rss_requires_auth = false            ; if true, fetch feed with cookies

  [INSTAPAPER_CONFIG]
  folder = My Articles                 ; optional folder name
  resolve_final_url = true             ; follow redirects before publishing
  retention = 30d                      ; optional; deletes items older than this via the Instapaper credential (per-feed filter)

  [MINIFLUX_CONFIG]
  feed_ids = 1,2,3                     ; target feeds to receive cookies
  refresh_frequency = 6h               ; how often to push cookies
  ```

Notes
- Prefer the web UI credential flow (see [docs/instapaper-onboarding.md](docs/instapaper-onboarding.md)) to collect a description, username, and password, exchange them for Instapaper tokens, and persist the encrypted secrets. If you cannot use the UI, you can temporarily include an `[INSTAPAPER_LOGIN]` section with `email` and `password` in the INI. When the INI references `instapaper_id` and tokens are missing, the worker will attempt the exchange, persist the tokens in `credentials.json`, and then remove `[INSTAPAPER_LOGIN]` from the INI.
- Per‑INI state is stored in `your_feed.ctrl`. You can set flags there:
  - force_run: Set to `true` to force a login/poll cycle on next loop.
  - force_sync_and_purge: Set to `true` to trigger Instapaper sync + retention purge.

Environment Variables
- DEBUG_LOGGING: `1` or `true` for verbose logs and ChromeDriver logging.
- ENABLE_SCREENSHOTS: `1` or `true` to save a screenshot after successful logins.
- SPF_PROFILE: Optional label for the current deployment profile. When set, the UI exposes it via `/ui-config` so you can confirm whether you're on dev, stage, or prod.

Running Locally
- Install dependencies: `pip install -r requirements.api.txt -r requirements.txt`
- Provide configuration files in a directory (see the templates section below) and export `CONFIG_DIR=/absolute/path/to/config` or pass `config_dir` payloads when enqueuing jobs.
- Start the API (exposes `/v1/*` endpoints and the configuration UI): `uvicorn app.main:app --reload --port 8000`
- Start the worker in a separate shell to process jobs and schedules: `python -m app.worker`
- Create credentials, site configs, and feeds through the API/UI, then queue jobs via `/v1/jobs` or recurring schedules via `/v1/job-schedules`.

Running with Docker
- Build images or pull the published ones.
- Use Docker Compose to launch the stack with a shared profile. For example: `docker compose -f templates/docker-compose.example.yml up --build`
  - The template starts Postgres, the API (`uvicorn app.main:app`), the background worker (`python -m app.worker`), and the optional Next.js web UI.
  - All configuration (credentials, site configs, feeds) is stored through the API in Postgres, so no host volume is required for legacy `.ini`/`.json` assets.
  - Set `CREDENTIALS_ENC_KEY` (32-byte base64 urlsafe string) and any required OIDC/Instapaper environment variables via the provided `env/*.env` profile files.

Profile-based Docker Compose configuration
- Copy one of the profile templates (`templates/env.dev.example`, `templates/env.stage.example`, or `templates/env.prod.example`) to `env/<profile>.env` and customize the values.
- Each profile enumerates the OIDC issuer/client settings, `API_BASE`/`NEXT_PUBLIC_API_BASE`, and feature toggles such as `USER_MGMT_CORE`, `USER_MGMT_UI`, `USER_MGMT_OIDC_ONLY`, and the SCIM flags.
- Reference the profile from Docker Compose via `env_file` (see the updated `templates/docker-compose.*` examples):
  ```yaml
  services:
    api:
      env_file:
        - ./env/dev.env
    web:
      env_file:
        - ./env/dev.env
  ```
- Set `SPF_PROFILE` (and optionally `NEXT_PUBLIC_SPF_PROFILE`) in each profile file to label the deployment (for example `dev`, `stage`, or `prod`). The UI reads this value through `/ui-config` and exposes it via `window.__SPF_UI_CONFIG.profile` so you can display the active profile.
- Toggle feature flags by editing the boolean values in the profile; the API, worker, and web containers will inherit the same defaults when they share the `env_file` entry.

Operational Details
- Headless browser: Uses Chrome with `--headless=new`; no X server required.
- WebDriver: `webdriver-manager` auto‑downloads a compatible ChromeDriver at runtime.
- Cookies: Captured cookies are filtered by `cookies_to_store` and cached in the database-backed cookie store keyed by the site login/site config pair, along with timestamps.
- State: The `.ctrl` file tracks last poll times and a local bookmark cache for sync/purge.
- Error handling: Network and parsing errors are logged; the service continues polling.
- API error responses follow [RFC 7807](https://www.rfc-editor.org/rfc/rfc7807) and are returned as
  `application/problem+json` objects that include a trace identifier header (`X-Trace-Id`), the
  machine-readable error code, HTTP status, and optional `details` payload when available.

Security & Tips
- Treat credentials and Instapaper app secrets managed through the API as sensitive; restrict database and backup access accordingly.
- Use a dedicated Instapaper app key/secret for this service.
- For private feeds and paywalled content, confirm the site’s terms of service allow automated access.
- Pin package versions in `requirements.txt` for reproducibility in long‑running setups.

Templates
- Copy these templates, place them alongside your Compose files, rename (remove `.example`), and edit values:
  - `templates/env.{dev,stage,prod}.example` → `env/<profile>.env` for Docker Compose profiles
  - `templates/docker-compose.api.example.yml` → `docker-compose.yml` (API + Postgres for local development)
  - `templates/docker-compose.example.yml` → `docker-compose.yml` (API + worker + optional web)
  - `templates/docker-compose.prod.yml` → `docker-compose.yml` (production stack)
- Provision credentials, site configurations, and feeds directly through the API or web UI instead of maintaining local `.ini`/`.json` files.

## Observability

### Sentry

Both the API and the Next.js web application emit errors to Sentry when a DSN is provided. Configure the following environment variables for production deployments:

- `SENTRY_DSN`: Server-side DSN used by the API and to bootstrap the web app during SSR.
- `SENTRY_ENVIRONMENT`: Environment label shown in Sentry (for example `prod`, `staging`).
- `SENTRY_RELEASE`: Optional release identifier attached to events.
- `NEXT_PUBLIC_SENTRY_DSN`: Client-side DSN (defaults to `SENTRY_DSN` in the provided Docker Compose template).
- `NEXT_PUBLIC_SENTRY_ENVIRONMENT`: Client-side environment label (defaults to `SENTRY_ENVIRONMENT`).
- `NEXT_PUBLIC_SENTRY_RELEASE`: Client-side release identifier (defaults to `SENTRY_RELEASE`).

When building the web image with source map upload enabled, also provide `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` so the Next.js build can publish artifacts. The production Docker Compose template now exposes these variables for easy wiring.

## Web dashboard welcome page

The `/` route now doubles as a public landing page. Signed-in users continue to see the operational dashboard, while anonymous visitors receive a configurable hero block with the product headline, description, and optional call-to-action.

To customize the welcome message:

1. Sign in with an administrator account.
2. Open **Admin → Site settings**.
3. Update the headline, subheadline, long-form body (supports Markdown), and optional CTA text/URL.
4. Save the changes to publish them immediately to the public landing experience.

If any fields are left blank the UI falls back to safe defaults so visitors always see a friendly welcome and sign-in button.

Quickstart
- Copy one of the `templates/env.<profile>.example` files to `env/dev.env` (or similar) and customize values such as the OIDC issuer, API base URL, and feature flags.
- Export `CREDENTIALS_ENC_KEY` (32-byte base64 urlsafe string) and run database migrations via `alembic upgrade head` (or `docker compose run migrate`).
- Start the API (`uvicorn app.main:app --reload --port 8000`) and worker (`python -m app.worker`) or launch the Compose stack (`docker compose -f templates/docker-compose.example.yml up`).
- Create credentials, site configurations, and feeds through the API or UI (`/v1/credentials`, `/v1/site-configs`, `/v1/feeds`).
- Schedule logins, RSS ingestion, and Instapaper publishing via `/v1/job-schedules` or trigger jobs on demand through `/v1/jobs`.

## Testing

See [docs/testing-guidelines.md](docs/testing-guidelines.md) for the required UI suites and conventions.

To run the web workspace tests locally:

1. `cd web`
2. Install dependencies if you have not already: `npm install`
3. Execute the Vitest component and accessibility suites once: `npm run test -- --run`

> Browser-based Playwright smoke coverage is temporarily paused while we wait for GitHub Actions service-container support. Track the follow-up in [ROADMAP.md](ROADMAP.md#release--distribution).

To verify Postgres row-level security policies:

- Start a database (for example, `docker compose -f templates/docker-compose.api.example.yml up -d db`).
- Export a Postgres DSN, e.g., `export TEST_POSTGRES_URL=postgresql+psycopg2://app:app@localhost:5432/app`.
- Run the dedicated suite: `pytest tests/test_rls_policies.py -m postgres`.

API (OIDC + DB) — Optional Preview
- Install API deps: `pip install -r requirements.api.txt`
- Set env for OIDC: `OIDC_ISSUER` and either `OIDC_AUDIENCE` or `OIDC_CLIENT_ID` (optionally `OIDC_JWKS_URL`, `OIDC_USERINFO_ENDPOINT`)
- Set DB URL (defaults to SQLite): `DATABASE_URL=sqlite:///./dev.db`
- User-management APIs are exposed by default. Set `USER_MGMT_CORE=0` (or any non-truthy value) if you need to temporarily disable `/v1/admin/users`, `/v1/admin/audit`, or OIDC auto-provisioning.
- Set encryption key for secrets (32-byte base64 urlsafe):
  - `export CREDENTIALS_ENC_KEY=$(python - <<'PY'
import os, base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())
PY
  )`
- Run API: `uvicorn app.main:app --reload --port 8000`
- Run worker (job processor): `python -m app.worker`
- Endpoints: `/v1/status`, `/v1/site-configs`, `/v1/credentials`, `/v1/feeds`, `/v1/jobs` (Bearer token required except `/v1/status`)
 - Bookmarks: `/v1/bookmarks` (list with filters/pagination, delete with optional Instapaper removal)

## OIDC Configuration

### Backend settings

- `OIDC_ISSUER`: Point to the base issuer URL from your identity provider (for example, `https://idp.example.com/realms/main`). The API trims a trailing `/.well-known/openid-configuration` segment, so you can supply either the bare issuer or the full discovery document URL.
- `OIDC_AUDIENCE`: Optional explicit audience used when validating tokens. Provide this when your IdP emits a distinct `aud` claim (for multi-client deployments). If omitted, the API falls back to `OIDC_CLIENT_ID` when present.
- `OIDC_CLIENT_ID`: Required when you rely on the client ID for the API's `aud` check or when a single value should align with both the frontend and backend. Set this to the client identifier that matches your IdP registration.
- `OIDC_JWKS_URL`: Optional override that points directly to the signing keys (JWKS) endpoint. Leave unset to let the API discover `jwks_uri` from the issuer's discovery document.
- `OIDC_USERINFO_ENDPOINT`: Optional absolute URL to the IdP's UserInfo endpoint. When configured, the API enriches access-token claims with the UserInfo payload so auto-provisioning can pick up names, emails, and group/role assignments that are omitted from the JWT.
- `DEV_NO_AUTH`: Set to `1`/`true` to bypass OIDC entirely and issue a synthetic developer identity. Only use this for local development.
- `DEV_USER_SUB`, `DEV_USER_EMAIL`, `DEV_USER_NAME`, `DEV_USER_GROUPS`: Customize the placeholder identity returned while `DEV_NO_AUTH` is enabled. Groups are provided as a comma-separated list.
- `USER_MGMT_CORE`: Enabled by default to expose the core user-management APIs. Set to `0`, `false`, `no`, or leave an empty string to opt out while keeping the rest of the stack online.
- `OIDC_AUTO_PROVISION_USERS`: Enable to automatically create or update `User` records when new identities sign in. Requires `USER_MGMT_CORE` to be active.
- `OIDC_AUTO_PROVISION_DEFAULT_ROLE`: Optional role name to assign to newly provisioned users. When set, the backend attempts to grant (or create) the role after provisioning succeeds.

### Frontend (NextAuth.js) settings

- `API_BASE` / `NEXT_PUBLIC_API_BASE`: Keep these aligned with where the API is reachable from the Next.js server (SSR) and browser clients respectively.
- `NEXTAUTH_SECRET`: Secret used by NextAuth for signing/encryption. Generate a strong random string for production.
- `OIDC_ISSUER`: Must match the backend issuer and the IdP registration.
- `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`: The client credentials issued by your IdP. They must match the API's expectations so that the resulting tokens pass the `aud` check.
- `OIDC_AUTO_LOGIN` / `NEXT_PUBLIC_OIDC_AUTO_LOGIN`: Optional flag (`1`/`true`/`yes`) that enables automatic redirects back through the IdP when the browser encounters a 401 from the API. Leave unset (default) to surface the error instead of forcing an immediate sign-in.
- `OIDC_DISPLAY_NAME_CLAIM`: Optional override that selects which claim supplies the signed-in user's display name. Provide the claim key (for example, `name` or `custom:display_name`). When unset, the UI searches for `display_name` variants (case/namespace insensitive) and falls back to the base profile name.
- Callback URL: NextAuth handles the OIDC response at `/api/auth/callback/oidc` (see `web/pages/api/auth/[...nextauth].ts`). Ensure this path is included in your IdP client's redirect URIs.
- Scope and checks: The default provider configuration requests `openid profile email groups` and enforces PKCE + state. Make sure the IdP client allows those scopes and the authorization code flow.

### Using Authelia as the IdP

1. **Register a client in Authelia.** Add a confidential client under `identity_providers.oidc.clients` that mirrors the values SubPaperFlux will use:

   ```yaml
   identity_providers:
     oidc:
       # ...global OIDC settings...
       clients:
         - client_id: subpaperflux
           client_name: SubPaperFlux UI
           client_secret: "$pbkdf2-sha512$..."  # generate with `authelia crypto hash generate`
           public: false
           authorization_policy: two_factor  # choose the policy that matches your MFA requirements
           redirect_uris:
             - https://app.example.com/api/auth/callback/oidc
             - http://localhost:3000/api/auth/callback/oidc  # optional: local dev callback
          scopes:
            - openid
            - profile
            - email
            - groups
           grant_types:
             - authorization_code
           response_types:
             - code
           token_endpoint_auth_method: client_secret_basic
           require_pkce: true
   ```

   Authelia expects hashed secrets: run `authelia crypto hash generate pbkdf2 --random --length 48` (or your preferred hash helper) and paste the output into `client_secret`. Restart Authelia after updating the configuration so the new client is loaded.

2. **Expose the discovery document.** Authelia publishes issuer metadata at `https://<authelia-host>/.well-known/openid-configuration`. Set `OIDC_ISSUER` on both the API and web app containers to the base issuer URL (for example, `https://auth.example.com`).

3. **Align client credentials.** Authelia emits the `client_id` as the `aud` claim by default. Set `OIDC_CLIENT_ID` on both the API and web services to that identifier, export `OIDC_CLIENT_SECRET` for the Next.js app so it can complete the authorization-code exchange, and only define `OIDC_AUDIENCE` if you configure Authelia to mint a different `aud` value.

4. **JWKS without discovery.** If you disable discovery in Authelia, manually point `OIDC_JWKS_URL` to the JWKS endpoint (typically `https://<authelia-host>/.well-known/jwks.json`). Otherwise, leave it unset so the API discovers the signing keys automatically.

### Verify the setup

- Fetch the issuer metadata (for example, `curl https://auth.example.com/.well-known/openid-configuration`) to ensure discovery works and the JWKS URI is reachable.
- Sign in through the web app and confirm the API accepts the issued access token (HTTP 200 from a protected endpoint). If validation fails, review `aud`, `iss`, and signature checks against your `OIDC_*` settings.
- When `OIDC_AUTO_PROVISION_USERS` is enabled, verify that new users appear in the `/v1/admin/users` API (or backing database) after their first login and that any default role assignment succeeds.
- Optionally, inspect Authelia logs for successful authorization code, token, and JWKS requests to confirm the full round-trip.

Frontend (Next.js) API Base Resolution
- The web UI discovers the API base at runtime so you can deploy without rebuilds and support different domains/subpaths.
- Resolution order (client): `NEXT_PUBLIC_API_BASE` (build-time) → `window.__SPF_API_BASE` → `GET /ui-config` (runtime) → relative base `''` (same-origin proxy).
- Resolution order (server): `API_BASE` (runtime env) → `NEXT_PUBLIC_API_BASE` → `''`.
- To proxy the API under the same domain with a subpath (recommended): set `API_BASE=/api` on the web container and configure your reverse proxy to route `/api/*` to the backend.

Testing
- **Local component loop**
  1. Start the API: `make dev-api` (bootstraps a virtualenv, runs Alembic migrations for non-SQLite databases, and serves FastAPI on port 8000).
  2. In a second terminal start the web app: `cd web && npm install && npm run dev`. The dev server reads defaults for `NEXT_PUBLIC_API_BASE`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and `NEXTAUTH_SECRET`, so no extra exports are needed for the happy path.
  3. With both services running, execute the Vitest component and accessibility suites: `npm run test -- --run` (or `npm run test:a11y -- --run` to focus on accessibility).
- **Browser E2E status**
  - Playwright smoke coverage is temporarily paused while we wait for GitHub Actions service-container support. Follow the roadmap item in [ROADMAP.md](ROADMAP.md#release--distribution) for progress on restoring these tests.
- **Additional guidance**
  - Reference [`docs/testing-guidelines.md`](docs/testing-guidelines.md) for expected coverage and tips on extending the suite.
  - If you need the worker for background jobs, run it in another shell via `python -m app.worker` before kicking off the tests.
- For a separate domain: set `API_BASE=https://api.example.com` on the web container. Optionally set `NEXT_PUBLIC_API_BASE` at build time (not required).
- The UI warns in the console if loaded over HTTPS while the configured base is `http://` (mixed content).
- The endpoint `/ui-config` serves `{ apiBase }` from server env; ensure your proxy does not intercept it.

Local Environment Examples
- API env example: `api.env.example`
  - Copy to `.env` or export manually:
    - `cp api.env.example .env`
    - `source .env`
  - Or run one-off: `DATABASE_URL=sqlite:///./dev.db uvicorn app.main:app --port 8000`
- Web env example: `web/.env.local.example`
  - Copy to `web/.env.local` and start dev server:
    - `cp web/.env.local.example web/.env.local`
    - `cd web && npm install && npm run dev`
  - Update OIDC values to match your IdP for real authentication.

Local Dev via Make
- One command (API + Web):
  - `make dev`
  - Does: create venv, install deps, apply Alembic migrations to SQLite `dev.db`, start API on :8000 (background), start Next.js on :3000 (foreground) pointing to the API.
- Run separately (two terminals):
  - API: `make dev-api`
  - Web: `make dev-web`
- Defaults and env vars:
  - Uses SQLite by default: `DATABASE_URL=sqlite:///./dev.db`
  - Override for Postgres: `DATABASE_URL=postgresql://user:pass@localhost:5432/subpaperflux`
- Web uses placeholders for OIDC; set real `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `NEXTAUTH_SECRET` for actual sign-in.

End-to-End Tests
- Browser-based Playwright smoke coverage is temporarily on hold pending GitHub Actions service-container support. Track the re-enablement effort via [ROADMAP.md](ROADMAP.md#release--distribution).

Credentials (DB-backed)
- Store user secrets in the DB via `/v1/credentials` with `kind` and `data`:
  - `site_login`: `{ "username": "...", "password": "..." }`
  - `miniflux`: `{ "miniflux_url": "...", "api_key": "..." }`
- `instapaper`: `{ "oauth_token": "...", "oauth_token_secret": "..." }` (populate via the `/v1/credentials/instapaper/login` onboarding flow that collects a description plus username/password; see `docs/instapaper-onboarding.md`)
  - `instapaper_app` (global or user): `{ "consumer_key": "...", "consumer_secret": "..." }`
- Handlers prefer DB credentials by `id` (or by `kind` for `instapaper_app`), and fall back to file templates if not found.
- API responses mask sensitive values (e.g., tokens, passwords). Stored values are encrypted at rest using AES‑GCM with `CREDENTIALS_ENC_KEY`.

Job Types (preview)
- `login`: payload `{ "site_login_pair": "<credId>::<siteId>" }`
- `miniflux_refresh`: payload `{ "miniflux_id": "<DB_MINIFLUX_ID>", "feed_ids": [1,2,3], "site_login_pair": "<credId>::<siteId>" }`
- `rss_poll`: payload `{ "feed_id": "<DB_FEED_ID>", "is_paywalled": false, "rss_requires_auth": false }` (collects matching entries and stores them as bookmarks in the local cache; feed-level site login settings are reused automatically)
- `publish`: payload `{ "instapaper_id": "<DB_INSTAPAPER_ID>", "feed_id": "Optional <DB_FEED_ID>", "folder": "Optional" }` (consumes stored bookmarks and sends them to Instapaper; omit `feed_id` to publish across all feeds, or include it to restrict the run to a single feed)
- `retention`: payload `{ "instapaper_id": "<DB_INSTAPAPER_ID>", "older_than": "30d", "feed_id": "Optional" }` (requires an Instapaper credential and can optionally scope to a specific feed when pruning)

Notes: Handlers dispatch real work using the existing subpaperflux functions. Publish persists bookmark metadata (including published timestamps when available); retention deletes old bookmarks in Instapaper and removes them from the DB. Jobs retry up to `WORKER_MAX_ATTEMPTS` with last error tracked on the job.

Database Migrations (Alembic)
- Install API deps (includes Alembic): `pip install -r requirements.api.txt`
- Set DB URL: `export DATABASE_URL=sqlite:///./dev.db` (or your Postgres URL)
- Upgrade to latest: `alembic upgrade head`
- Create a new migration (after model changes): `alembic revision --autogenerate -m "your message"`
- Downgrade (if needed): `alembic downgrade -1`
