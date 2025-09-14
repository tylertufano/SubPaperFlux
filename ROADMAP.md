# UI Roadmap

Below is a pragmatic, phased roadmap and feature set for a robust, delightful UI. It layers value quickly, keeps complexity manageable, and aligns with the API you’ve built.

## Phase 0 — Foundations

- Auth (OIDC): Secure login via provider; session handling; token refresh.
- Design System: Pick a UI kit (e.g., MUI or Tailwind + Headless) for consistency and velocity.
- Routing/Layout: App shell with nav, breadcrumbs, responsive breakpoints.
- SDK Integration: Use generated TypeScript SDK + typed models for API calls.
- Error + Empty States: Friendly messages, retry actions, contact link.
- State & Caching: SWR/React Query for caching, retries, optimistic updates.
- Accessibility: Semantic markup, focus states, ARIA, color contrast checks.
- i18n-Ready: Wrap text for translation; locale switch scaffold.

## Phase 1 — Core UX (MVP)

- Dashboard: At-a-glance cards for bookmarks count, jobs status, last sync, health checks.
- Bookmarks: Paginated list with search, fuzzy toggle (PG), filters (feed, date range), sorting, bulk delete.
- Jobs: List with status filters; retry action; detail flyout with payload, attempts, errors.
- Credentials: List masked creds; create/update/delete forms; test actions inline (Instapaper/Miniflux).
- Site Configs: List global + mine; create/update/delete; test login “dry run”.
- Feeds: List + create/update; link to related site configs/credentials.
- Admin: PG prep (extensions/indexes), enable RLS; health/status panels.

## Phase 1.5 — Harden and Accelerate

### Integrate the generated TypeScript SDK

- Run:

```sh
make openapi-export API_BASE=http://localhost:8000
make sdk-ts
```

- Replace `web/lib/api.ts` with SDK client usage and typed models on pages.
- Centralize auth injection (Bearer token) via the SDK configuration.

### Add CRUD forms (Credentials + Site Configs)

- Simple modals/forms for create/update/delete; use CSRF header if you deploy cookie-mode auth.
- Reuse masking rules from API; never echo secrets in UI logs.

### Add fuzzy search toggle for bookmarks

- Use the `fuzzy=true` param to leverage Postgres trigram similarity sorting.

### Add basic i18n

- Start with core UI strings; prepare for future localization.

### Testing

- Add component tests for filters/pagination and form validations.
- Add a minimal E2E flow: login → create credential → test → list bookmarks → bulk delete dry-run (as applicable).

### Queue/Idempotency UX prep

- Show dedupe feedback in the UI when publish is skipped due to idempotency.
- Surface job backoff timers and `last_error` messages in the Jobs table.
- Add manual “dead-letter” queue view and “Retry All failed”.

## Phase 2 — Power Features

- Saved Views: Persist filters/sorts/search as named views per user.
- Advanced Search: Field-specific (`title:`/`url:`), regex (PG only), similarity sort.
- Bulk Actions: Multi-select publish/delete/export; progress modals.
- Tags & Folders: Tagging UX for Instapaper; default folder picker; tag autosuggest.
- Preview Pane: Inline article preview (sanitized HTML) before publishing.
- Jobs Streaming: Live updates via WebSocket/SSE; pill notifications on status changes.
- Activity Log: Per-user audit trail: who/what/when; filterable.

## Optional / Recommended (Consider in Future Phases)

These are remaining optional/recommended items, plus targeted updates to Docker and templates to reflect the new API/DB/UI framework.

### Accessibility (a11y)

- Expand ARIA labeling beyond table headers (e.g., form inputs with `aria-describedby`, error regions with `role=alert`).
- Keyboard navigation patterns (focus traps for modals, access keys).
- Color contrast audits and dark mode.

### Internationalization (i18n)

- Expand string catalog beyond Nav/Home (pages, buttons, alerts).
- Locale detection and formatting (dates, numbers).

### Observability

- Add per-endpoint histograms (standardized path labels) and job durations by type bucket.
- Sentry client for UI and better grouping.

### Security

- DB RLS: Enforce by setting a session variable (e.g., `app.user_id`) on each DB connection. Policies exist; enforcement at the DB layer requires that session setting.
- CSRF: UI already sends `X-CSRF-Token`; consider per-session token.

### API Polish

- Optional uniform responses for integration tests (convert errors to `application/problem+json` to match global handlers while keeping `ok/status`).
- SSE/WebSockets for jobs to remove polling.

## Phase 3 — Onboarding & Guidance

- Setup Wizard: Steps for app creds, user tokens, site config, feed setup, test buttons each step.
- Inline Tips: Contextual helper bubbles/tooltips; links to docs/examples.
- Templates Gallery: Predefined site-config templates; one-click import.

## Phase 4 — Multi-User & Sharing

- RBAC UI: Role badges; guard admin-only controls; visible scope (Global vs Mine).
- Global Assets: Browse + “Copy to my workspace” for global configs.
- Org Views: Admin dashboards for system usage; user management (read-only if delegated to IdP).

## Phase 5 — Observability & Ops

- Metrics View: Prometheus charts in UI (jobs throughput, API latency, error rates).
- Health Console: Integration checks with last run status; rate-limit insights.

### Admin & System

- PG Prep: Buttons for `pg_trgm`/indexes; result details.
- RLS: Enable/disable with warnings; doc links.
- System View: OpenAPI doc link, metrics endpoint, version.

## UX Details

- Consistency: Standard pagination (`page`/`size`), sorting, search input patterns.
- Keyboard Shortcuts: `/` to focus search; `j/k` navigate lists; `?` shows help.
- Empty States: Show templates/onboarding actions instead of blank tables.
- Confirmation: Dangerous actions gated (bulk delete, global changes).
- Responsive: Card layouts on mobile; hide advanced filters behind Drawer.

## Security & Privacy

- Token Handling: Use access token only; never store secrets client-side.
- CSRF: If cookie-mode auth to API, include `X-CSRF-Token` automatically.
- CORS: Narrow origins to UI domain; preflight caching.
- PII: Mask secrets at API; UI never logs sensitive fields.

## Performance & Robustness

- Retry Policies: Network failure retry with exponential backoff in SDK.
- Backpressure: Disable/enqueue bulk buttons if rate limits hit; show wait times.
- Optimistic UX: For deletes and retries; reconcile on server response.

## Testing & Quality

- Unit: Component tests for filters, pagination, modals.
- Integration: Mock SDK to simulate API; test flows (create creds → test → publish).
- E2E: Cypress/Playwright for login, CRUD, job retry, bulk delete.
- Accessibility: Axe audits in CI; color contrast testing.

## CI/CD & Ops

- Builds: Lint, type-check, unit tests, E2E smoke; bundle analysis.
- Envs: Dev/Stage/Prod with distinct OIDC + API base; feature flags for experimental features.
- Error Reporting: Sentry client SDK; breadcrumb logs; user-friendly fallback.

## Data Migrations & Compatibility

- API Compatibility: Use `/v1` endpoints only; track deprecations.
- SDK Versioning: Lock SDK version per UI release; changelog and upgrade notes.

## Rollout Plan

- Milestones: Phase 1 (2–3 sprints), Phases 2–3 (2–4 sprints), subsequent phases in parallel tracks (UI/BE/Ops).
- Feedback Loops: In-app feedback link; analytics (anonymized) to prioritize features.

---

## Continued Enhancements: User Management

Here’s a compact plan to track “User Management” as its own phase (or parallel stream), with scope, design, and dependencies.

- Goals: Native users, roles, and admin controls alongside OIDC support.
- Strategy: Keep OIDC as primary; add first‑class users/roles for finer control and auditability.

### Scope

- Users Table: `users(id, sub, email, name, status, created_at, last_login_at)`.
- Roles & RBAC: System roles (`admin`, `site-config-admin`, `global-creds-admin`, `user`) + per‑resource ownership by `owner_user_id`.
- Group Mapping: Map OIDC groups → internal roles; allow per‑user overrides in DB.
- Admin UI: List users, assign roles, suspend/reactivate, view login history.
- Audit Log: Track admin changes (roles, global resources, retention runs).
- API Keys: Optional personal access tokens for automation (scoped, expiring).
- Quotas/Policies: Per‑user caps (feeds, credentials, job rate) to protect system.
- RLS Enforcement: Set `app.user_id` per DB session to enforce Postgres Row‑Level Security.

### Integrations

- OIDC‑Only Mode: Keep today’s SSO‑only flow; auto‑provision users on first login.
- SCIM/Sync (Optional): Import users/roles from IdP; nightly role reconciliation.

### Data Model Additions

- `users`: `id` (uuid), `sub` (OIDC), `email`, `name`, `status`, `created_at`, `updated_at`.
- `roles`: `id`, `name`; `user_roles`: `user_id`, `role_id`.
- `audit_log`: `id`, `actor_user_id`, `action`, `entity_type`/`entity_id`, `metadata` JSON, `timestamp`.
- `api_tokens` (optional): `id`, `user_id`, `hash`, `scopes`, `expires_at`, `last_used_at`.

### API Endpoints

- Admin: `/v1/admin/users` (list/filter), `/v1/admin/users/{id}` (get/update roles/status), `/v1/admin/audit` (list).
- Tokens (optional): `/v1/me/tokens` CRUD with revocation; scoped to user.

### UI

- Users: Table with search/filter; role badges; actions (assign roles, suspend).
- Audit: Filter by actor/date/action; drill into metadata.
- Tokens: Developer page to create/revoke tokens; copy‑once UI.

### Security

- Least Privilege: Restrict admin flows to admins; sensitive actions double-confirm.
- Secrets: Existing encryption stays; ensure only owners/admins can access (UI/API).
- RLS: Enforce DB policies by setting `app.user_id` per request/connection (backend work).

### Observability

- Metrics: `user_logins_total`, `admin_actions_total`, `api_tokens_issued_total`.
- Alerts: Excessive failed logins (if you track), unusual admin changes.

### Dependencies & Pre‑Reqs

- DB Migrations: Add users/roles/audit tables; indices for email/sub.
- Session Var: Middleware to set `app.user_id` in DB for RLS, using current user `sub`.
- OIDC Mapping: Configurable group→role map; dev defaults for quick start.

### Rollout Plan

- Phase A: Users + roles + OIDC mapping + admin list/assign.
- Phase B: Audit log + UI + metrics.
- Phase C (Optional): API tokens + SCIM import + quotas.

