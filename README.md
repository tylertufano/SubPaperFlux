# SubPaperFlux

SubPaperFlux continuously bridges RSS feeds and Instapaper, with optional paywall-aware fetching and Miniflux cookie updates. It can log in to sites via headless Chrome to capture authentication cookies, push those cookies to Miniflux feeds, poll RSS for new entries, and publish them to Instapaper. It maintains lightweight state per INI file so it can run as a long‑lived service.

This repo contains the main service script `subpaperflux.py`, a Dockerfile for a slim runtime, and example configuration formats.

**Key Features**
- Headless logins: Uses Selenium + Chrome to authenticate and capture cookies.
- Miniflux integration: Updates specified Miniflux feeds with fresh cookies.
- RSS polling: Fetches and filters feed entries using flexible schedules and lookbacks.
- Instapaper publishing: Sends URLs or full HTML (for paywalled content) to Instapaper, with folder and tag support.
- Stateful operation: Tracks last poll time, last processed entry, and local bookmark cache for sync/purge.
- Retention and purge: Optional retention to delete old Instapaper bookmarks.

**How It Works**
- You provide an INI file per feed with references to JSON config blocks.
- On a schedule, the service optionally logs in (headless), updates Miniflux cookies, polls the RSS feed, then publishes new items to Instapaper.
- State is stored per INI as a `.ctrl` file next to your INI; cookies are cached in `cookie_state.json`.

Requirements
- Python 3.11+ (Docker image uses Python 3.12 slim).
- Google Chrome available (the Docker image installs `google-chrome-stable`).
- Instapaper app credentials (consumer key/secret) and an Instapaper login that the web UI can exchange for long-lived tokens.

Configuration Overview
- Put all configuration files in one directory and point the service to either a single `.ini` in that directory or the whole directory.
- The service expects these files:
  - `credentials.json`: IDs and secrets for logins, Instapaper, and Miniflux. Instapaper entries should start with placeholders; complete the onboarding flow in the UI to exchange the username/password for tokens and persist them.
  - `site_configs.json`: Site‑specific login selectors and cookie names.
  - `instapaper_app_creds.json`: Instapaper app consumer key/secret.
  - `cookie_state.json`: Automatically managed cache of cookies (created/updated by the service).
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
  - site_url: Login page URL.
  - username_selector: CSS selector for the username input.
  - password_selector: CSS selector for the password input.
  - login_button_selector: CSS selector for the submit button.
  - cookies_to_store: Array of cookie names to capture and reuse.
  - post_login_selector: Optional CSS selector expected after login (for success check).

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
  is_paywalled = false                 ; if true, script can fetch HTML with cookies
  rss_requires_auth = false            ; if true, fetch feed with cookies

  [INSTAPAPER_CONFIG]
  folder = My Articles                 ; optional folder name
  resolve_final_url = true             ; follow redirects before publishing
  retention = 30d                      ; optional; delete items older than this

  [MINIFLUX_CONFIG]
  feed_ids = 1,2,3                     ; target feeds to receive cookies
  refresh_frequency = 6h               ; how often to push cookies
  ```

Notes
- Prefer the web UI credential flow (see [docs/instapaper-onboarding.md](docs/instapaper-onboarding.md)) to collect a description, username, and password, exchange them for Instapaper tokens, and persist the encrypted secrets. If you cannot use the UI, you can temporarily include an `[INSTAPAPER_LOGIN]` section with `email` and `password` in the INI. When the INI references `instapaper_id` and tokens are missing, the script will attempt the exchange, persist the tokens in `credentials.json`, and then remove `[INSTAPAPER_LOGIN]` from the INI.
- Per‑INI state is stored in `your_feed.ctrl`. You can set flags there:
  - force_run: Set to `true` to force a login/poll cycle on next loop.
  - force_sync_and_purge: Set to `true` to trigger Instapaper sync + retention purge.

Environment Variables
- DEBUG_LOGGING: `1` or `true` for verbose logs and ChromeDriver logging.
- ENABLE_SCREENSHOTS: `1` or `true` to save a screenshot after successful logins.

Running Locally
- Install dependencies: `pip install -r requirements.txt`
- Run against a single INI: `python subpaperflux.py /path/to/config/myfeed.ini`
- Or a directory of INIs: `python subpaperflux.py /path/to/config`

Running with Docker
- Build: `docker build -t subpaperflux .`
- Run: `docker run --rm -e DEBUG_LOGGING=1 -v /absolute/path/to/config:/config subpaperflux`
  - The container runs `python ./subpaperflux.py /config` by default.
  - Ensure `credentials.json`, `site_configs.json`, and `instapaper_app_creds.json` exist under `/config`.

Operational Details
- Headless browser: Uses Chrome with `--headless=new`; no X server required.
- WebDriver: `webdriver-manager` auto‑downloads a compatible ChromeDriver at runtime.
- Cookies: Captured cookies are filtered by `cookies_to_store` and cached in `cookie_state.json` with timestamps.
- State: The `.ctrl` file tracks last poll times and a local bookmark cache for sync/purge.
- Error handling: Network and parsing errors are logged; the service continues polling.

Security & Tips
- Treat `credentials.json` and `instapaper_app_creds.json` as secrets. Do not commit them.
- Use a dedicated Instapaper app key/secret for this service.
- For private feeds and paywalled content, confirm the site’s terms of service allow automated access.
- Pin package versions in `requirements.txt` for reproducibility in long‑running setups.

Templates
- Copy these templates, place them in your config directory, rename (remove `.example`), and edit values:
  - `templates/subpaperflux.example.ini` → `yourfeed.ini`
  - `templates/credentials.example.json` → `credentials.json`
  - `templates/site_configs.example.json` → `site_configs.json`
  - `templates/instapaper_app_creds.example.json` → `instapaper_app_creds.json`
- After copying `credentials.json`, run through the Instapaper onboarding flow in the UI so the referenced `instapaper_id` entries receive tokens automatically.

Quickstart
- mkdir `config/`; copy and rename templates above into `config/`.
- Edit IDs in `yourfeed.ini` to match keys in your JSON files.
- Run locally: `python subpaperflux.py ./config/yourfeed.ini`
- Or Docker: `docker run --rm -v "$PWD/config":/config subpaperflux`

## Testing

See [docs/testing-guidelines.md](docs/testing-guidelines.md) for the required UI suites and conventions.

To run the web workspace tests locally:

1. `cd web`
2. Install dependencies if you have not already: `npm install`
3. Execute the Vitest component and accessibility suites once: `npm run test -- --run`
4. Point Playwright at a running API (for example, `export API_BASE=http://localhost:8000`) and launch the smoke test: `npm run test:e2e` (add `-- --headless` to mirror CI).

To verify Postgres row-level security policies:

- Start a database (for example, `docker compose -f templates/docker-compose.api.example.yml up -d db`).
- Export a Postgres DSN, e.g., `export TEST_POSTGRES_URL=postgresql+psycopg2://app:app@localhost:5432/app`.
- Run the dedicated suite: `pytest tests/test_rls_policies.py -m postgres`.

API (OIDC + DB) — Optional Preview
- Install API deps: `pip install -r requirements.api.txt`
- Set env for OIDC: `OIDC_ISSUER` and either `OIDC_AUDIENCE` or `OIDC_CLIENT_ID` (optionally `OIDC_JWKS_URL`)
- Set DB URL (defaults to SQLite): `DATABASE_URL=sqlite:///./dev.db`
- User-management APIs are exposed by default. Set `USER_MGMT_CORE=0` (or any non-truthy value) if you need to temporarily disable `/v1/admin/users`, `/v1/admin/audit`, or OIDC auto-provisioning.
- Set encryption key for secrets (32-byte base64 urlsafe):
  - `export CREDENTIALS_ENC_KEY=$(python - <<'PY'
import os, base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())
PY
  )`
- Run API: `uvicorn app.main:app --reload --port 8000`
- Run worker (job processor): `python -m app.worker`
- Endpoints: `/status`, `/site-configs`, `/credentials`, `/feeds`, `/jobs` (Bearer token required except `/status`)
 - Bookmarks: `/bookmarks` (list with filters/pagination, delete with optional Instapaper removal)

## OIDC Configuration

### Backend settings

- `OIDC_ISSUER`: Point to the base issuer URL from your identity provider (for example, `https://idp.example.com/realms/main`). The API trims a trailing `/.well-known/openid-configuration` segment, so you can supply either the bare issuer or the full discovery document URL.
- `OIDC_AUDIENCE`: Optional explicit audience used when validating tokens. Provide this when your IdP emits a distinct `aud` claim (for multi-client deployments). If omitted, the API falls back to `OIDC_CLIENT_ID` when present.
- `OIDC_CLIENT_ID`: Required when you rely on the client ID for the API's `aud` check or when a single value should align with both the frontend and backend. Set this to the client identifier that matches your IdP registration.
- `OIDC_JWKS_URL`: Optional override that points directly to the signing keys (JWKS) endpoint. Leave unset to let the API discover `jwks_uri` from the issuer's discovery document.
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
- Callback URL: NextAuth handles the OIDC response at `/api/auth/callback/oidc` (see `web/pages/api/auth/[...nextauth].ts`). Ensure this path is included in your IdP client's redirect URIs.
- Scope and checks: The default provider configuration requests `openid profile email` and enforces PKCE + state. Make sure the IdP client allows those scopes and the authorization code flow.

### Using Authelia as the IdP

1. **Register a client in Authelia.** In `configuration.yml` add an entry under `identity_providers.oidc.clients`:

   ```yaml
   identity_providers:
     oidc:
       # ...global OIDC settings...
       clients:
         - id: subpaperflux
           description: SubPaperFlux UI
           secret: <generated-client-secret>
           redirect_uris:
             - https://app.example.com/api/auth/callback/oidc
           scopes:
             - openid
             - profile
             - email
           grant_types:
             - authorization_code
           response_types:
             - code
           token_endpoint_auth_method: client_secret_basic
           require_pkce: true
   ```

   Adjust the `id`, `secret`, and redirect URL to match your deployment domain. Authelia enables state handling automatically; `require_pkce: true` keeps it aligned with the NextAuth PKCE check.

2. **Expose the discovery document.** Authelia publishes the issuer metadata at `https://<authelia-host>/.well-known/openid-configuration`. Set `OIDC_ISSUER` on both the API and web app to the base issuer URL (for example, `https://auth.example.com`).

3. **Align audience/client IDs.** Authelia emits the client ID as the `aud` claim by default. Set both `OIDC_CLIENT_ID` values (API and web) to the Authelia client `id`. Only set `OIDC_AUDIENCE` if you configure Authelia to emit a custom audience claim.

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
- **Local end-to-end loop**
  1. Start the API: `make dev-api` (bootstraps a virtualenv, runs Alembic migrations for non-SQLite databases, and serves FastAPI on port 8000).
  2. In a second terminal start the web app: `cd web && npm install && npm run dev`. The dev server reads defaults for `NEXT_PUBLIC_API_BASE`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and `NEXTAUTH_SECRET`, so no extra exports are needed for the happy path.
  3. With both services running, execute Playwright tests from `web/`: `npm run test:e2e`. Add `--headed` for interactive debugging or `--headless` to mirror CI.
- **CI pointers**
  - Use `make test-e2e` to mirror the GitHub Actions workflow. It provisions the virtualenv, ensures the database schema is ready (skipping Alembic when `DATABASE_URL` is SQLite), launches the API, and runs `npm run test:e2e` with `API_BASE`/`NEXT_PUBLIC_API_BASE` wired to the local services.
  - Set `CI=1` or `HEADLESS=1` in automated runs to force Chromium headless mode. Provide any custom secrets (`NEXTAUTH_SECRET`, OIDC issuer/client values, `NEXT_PUBLIC_CSRF_TOKEN`, etc.) through the environment before invoking the target.
  - Artifacts for failures (traces, videos, screenshots) are written under `web/test-results/`, and the HTML report lives in `web/playwright-report/`. Open traces locally with `npx playwright show-trace web/test-results/<test>/trace.zip`.
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
- Quick commands (see the Testing section above for prerequisites):
  - `npm run test:e2e` runs the Playwright suite (headed by default unless `CI`/`HEADLESS` is set).
  - `npm run test:e2e:ci` forces headless mode.
  - `make test-e2e ARGS=--headless` mirrors CI orchestration and stops services when complete.

Credentials (DB-backed)
- Store user secrets in the DB via `/credentials` with `kind` and `data`:
  - `site_login`: `{ "username": "...", "password": "..." }`
  - `miniflux`: `{ "miniflux_url": "...", "api_key": "..." }`
- `instapaper`: `{ "oauth_token": "...", "oauth_token_secret": "..." }` (populate via the `/credentials/instapaper/login` onboarding flow that collects a description plus username/password; see `docs/instapaper-onboarding.md`)
  - `instapaper_app` (global or user): `{ "consumer_key": "...", "consumer_secret": "..." }`
- Handlers prefer DB credentials by `id` (or by `kind` for `instapaper_app`), and fall back to file templates if not found.
- API responses mask sensitive values (e.g., tokens, passwords). Stored values are encrypted at rest using AES‑GCM with `CREDENTIALS_ENC_KEY`.

Job Types (preview)
- `login`: payload `{ "config_dir": "./config", "site_config_id": "<DB_SITE_ID>", "credential_id": "<DB_CRED_ID>" }`
- `miniflux_refresh`: payload `{ "config_dir": "./config", "miniflux_id": "<DB_MINIFLUX_ID>", "feed_ids": [1,2,3], "cookie_key": "<loginId-siteId>" }` (or provide `site_config_id` + `credential_id` to derive cookie_key)
- `rss_poll`: payload `{ "config_dir": "./config", "instapaper_id": "<DB_INSTAPAPER_ID>", "feed_url": "https://.../feed.xml", "lookback": "24h", "is_paywalled": false, "rss_requires_auth": false, "cookie_key": "<loginId-siteId>", "site_config_id": "<DB_SITE_ID>" }`
- `publish`: payload `{ "config_dir": "./config", "instapaper_id": "<DB_INSTAPAPER_ID>", "url": "https://...", "title": "Optional", "folder": "Optional" }`
- `retention`: payload `{ "older_than": "30d" }`

Notes: Handlers dispatch real work using the existing subpaperflux functions. Publish persists bookmark metadata (including published timestamps when available); retention deletes old bookmarks in Instapaper and removes them from the DB. Jobs retry up to `WORKER_MAX_ATTEMPTS` with last error tracked on the job.

Database Migrations (Alembic)
- Install API deps (includes Alembic): `pip install -r requirements.api.txt`
- Set DB URL: `export DATABASE_URL=sqlite:///./dev.db` (or your Postgres URL)
- Upgrade to latest: `alembic upgrade head`
- Create a new migration (after model changes): `alembic revision --autogenerate -m "your message"`
- Downgrade (if needed): `alembic downgrade -1`
