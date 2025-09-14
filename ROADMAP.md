# UI Roadmap

This roadmap now includes live status checkboxes and a reusable TODO reference. Use it to track progress and drive future prompts.

Status legend: [x] done, [ ] todo

## Phase 0 — Foundations

- [x] Auth (OIDC): Secure login via provider; session handling; token refresh.
  - Evidence: `web/pages/api/auth/[...nextauth].ts:1`
- [x] Design System: Tailwind CSS + Headless patterns.
  - Evidence: `web/tailwind.config.js:1`, `web/styles/globals.css:1`
- [x] Routing/Layout: App shell with nav, breadcrumbs, responsive breakpoints.
  - Evidence: `web/components/Nav.tsx:1`, Next.js pages in `web/pages`
- [ ] SDK Integration: Use generated TypeScript SDK + typed models for API calls.
  - [x] Centralized auth + JSON client in `web/lib/sdk.ts:1`
  - [x] Generated SDK present in `sdk/ts`
  - [ ] Pages use generated SDK types; remove legacy `web/lib/api.ts` usage (`web/pages/admin.tsx:2`)
- [ ] Error + Empty States: Friendly messages, retry actions, contact link.
  - [x] Alerts component exists: `web/components/Alert.tsx:1`
  - [ ] Purposeful empty states across pages
- [x] State & Caching: SWR for caching/retries/refresh.
  - Evidence: `web/package.json:15`, `web/pages/*:1`
- [ ] Accessibility: Semantic markup, focus states, ARIA, color contrast checks.
  - [ ] Add ARIA and contrast audits
- [ ] i18n-Ready: Wrap text for translation; locale switch scaffold.
  - [x] Minimal provider: `web/lib/i18n.tsx:29`
  - [ ] Expand string catalog beyond Nav/Home

## Phase 1 — Core UX (MVP)

- [ ] Dashboard
  - [ ] Health, counts, quick links (Home is placeholder: `web/pages/index.tsx:1`)
- [ ] Bookmarks
  - [x] Pagination, search, filters, fuzzy toggle: `web/pages/bookmarks.tsx:1`
  - [x] Bulk delete and export (JSON/CSV)
  - [ ] Sorting
- [x] Jobs
  - [x] Status filter, list, details flyout with payload/errors: `web/pages/jobs.tsx:1`
  - [x] Backoff timer and dedupe badges
  - [x] Retry and Retry All failed/dead
- [ ] Credentials
  - [x] List, create, delete
  - [x] Test Instapaper/Miniflux
  - [ ] Update forms
- [ ] Site Configs
  - [x] List, create, delete
  - [x] Test login
  - [ ] Update forms
- [ ] Feeds
  - [ ] List page and CRUD (used for selection only)
- [ ] Admin
  - [x] PG prep (pg_trgm/indexes) and enable RLS: `web/pages/admin.tsx:12`
  - [ ] Health/status panels and system info

## Phase 1.5 — Harden and Accelerate

### Integrate the generated TypeScript SDK

- [x] Export OpenAPI and generate SDK

```sh
make openapi-export API_BASE=http://localhost:8000
make sdk-ts
```

- [ ] Replace `web/lib/api.ts` calls with generated SDK client and types
- [x] Centralize auth injection (Bearer token) via configuration

### Add CRUD forms (Credentials + Site Configs)

- [x] Create/delete forms
- [ ] Update forms
- [x] CSRF header for cookie-mode auth
- [x] Never echo secrets in UI logs

### Add fuzzy search toggle for bookmarks

- [x] Use the `fuzzy=true` param to leverage Postgres trigram similarity sorting

### Add basic i18n

- [x] Provider + locale switch
- [ ] Extract core strings and page text

### Testing

- [ ] Component tests for filters/pagination and form validations
- [ ] Minimal E2E: login → create credential → test → list bookmarks → bulk delete (dry-run)

### Queue/Idempotency UX

- [x] Show dedupe feedback when publish is skipped
- [x] Surface job backoff timers and `last_error`
- [x] Retry All failed/dead
- [ ] Dead-letter queue view

## Phase 2 — Power Features

- [x] Saved Views (Bookmarks)
- [ ] Advanced Search: Field-specific (`title:`/`url:`), regex (PG only), similarity sort
- [ ] Bulk Actions
  - [x] Delete/export
  - [ ] Publish; progress modals
- [ ] Tags & Folders
- [ ] Preview Pane (sanitized HTML)
- [ ] Jobs Streaming (WebSocket/SSE)
- [ ] Activity Log

## Optional / Recommended

### Accessibility (a11y)

- [ ] Expand ARIA labeling (inputs, alerts)
- [ ] Keyboard navigation patterns (focus traps)
- [ ] Color contrast audits and dark mode

### Internationalization (i18n)

- [ ] Expand string catalog beyond Nav/Home
- [ ] Locale detection and formatting (dates, numbers)

### Observability

- [ ] Per-endpoint histograms and job durations (UI surfacing)
- [ ] Sentry client for UI and better grouping

### Security

- [ ] DB RLS: Set `app.user_id` per DB session (middleware)
- [x] CSRF: UI sends `X-CSRF-Token`

### API Polish

- [ ] Uniform error responses (`application/problem+json`)
- [ ] SSE/WebSockets for jobs to remove polling

## Phase 3 — Onboarding & Guidance

- [ ] Setup Wizard
- [ ] Inline Tips
- [ ] Templates Gallery

## Phase 4 — Multi-User & Sharing

- [ ] RBAC UI
- [ ] Global Assets (copy to my workspace)
- [ ] Org Views / user management (if not delegated to IdP)

## Phase 5 — Observability & Ops

- [ ] Metrics View (Prometheus in UI)
- [ ] Health Console (integration checks, rate-limit insights)

### Admin & System

- [x] PG Prep: Buttons for `pg_trgm`/indexes; result details
- [ ] RLS: Enable/disable with warnings; doc links
- [ ] System View: OpenAPI doc link, metrics endpoint, version

## UX Details

- [ ] Consistency: Standard pagination (`page`/`size`), sorting, search input patterns
- [ ] Keyboard Shortcuts: `/` focus search; `j/k` navigate; `?` help
- [ ] Empty States: Templates/onboarding actions instead of blank tables
- [x] Confirmation: Dangerous actions gated (bulk delete)
- [ ] Responsive: Card layouts on mobile; advanced filters in Drawer

## Security & Privacy

- [x] Token Handling: Use access token only; never store secrets client-side
- [x] CSRF: If cookie-mode auth to API, include `X-CSRF-Token`
- [x] CORS: Configurable allowlist in API
- [x] PII: Mask secrets at API; UI never logs sensitive fields

## Performance & Robustness

- [ ] Retry Policies: Network retry with exponential backoff in SDK
- [ ] Backpressure: Disable/enqueue bulk buttons if rate limits hit; show wait times
- [ ] Optimistic UX: Deletes/retries optimistic with reconciliation

## Testing & Quality

- [ ] Unit: Component tests for filters, pagination, modals
- [ ] Integration: Mock SDK to simulate API; test flows
- [ ] E2E: Playwright/Cypress for login, CRUD, job retry, bulk delete
- [ ] Accessibility: Axe audits in CI; color contrast testing

## CI/CD & Ops

- [ ] Builds: Lint, type-check, unit tests, E2E smoke; bundle analysis
- [ ] Envs: Dev/Stage/Prod with distinct OIDC + API base; feature flags
- [ ] Error Reporting: Sentry client SDK; breadcrumb logs; user-friendly fallback

## Data Migrations & Compatibility

- [ ] API Compatibility: Use `/v1` endpoints only; track deprecations
- [ ] SDK Versioning: Lock SDK version per UI release; changelog/upgrade notes

## Rollout Plan

- Milestones: Phase 1 (2–3 sprints), Phases 2–3 (2–4 sprints), subsequent phases in parallel tracks (UI/BE/Ops)
- Feedback Loops: In-app feedback link; anonymized analytics to prioritize features

---

## Continued Enhancements: User Management

- Goals: Native users, roles, and admin controls alongside OIDC support.
- Strategy: Keep OIDC as primary; add first‑class users/roles for finer control and auditability.

### Scope

- [ ] Users table and admin UI
- [ ] Roles & RBAC with per‑resource ownership
- [ ] OIDC group→role mapping with per-user overrides
- [ ] Audit log for admin actions
- [ ] API tokens (optional)
- [ ] Quotas/policies per user
- [ ] RLS enforcement: set `app.user_id` per DB session

### Integrations

- [ ] OIDC‑only mode auto-provision
- [ ] SCIM/Sync (optional)

### Data Model Additions

- [ ] `users`, `roles`, `user_roles`, `audit_log`, `api_tokens`

### API Endpoints

- [ ] `/v1/admin/users`, `/v1/admin/audit`, `/v1/me/tokens`

### UI

- [ ] Users table, role badges, suspend/reactivate
- [ ] Audit filters and details
- [ ] Token management UI

### Security & Observability

- [ ] Least privilege enforcement and confirmations
- [ ] Metrics: `user_logins_total`, `admin_actions_total`, `api_tokens_issued_total`

### Dependencies & Rollout

- [ ] DB migrations and session var middleware
- [ ] Rollout: Phase A (users/roles), B (audit/metrics), C (tokens/SCIM)

---

## Open TODO Reference

Use these IDs in future prompts to request specific work. We will keep this list updated as items are completed.

- UI-001: Replace `web/pages/admin.tsx` usage of `web/lib/api.ts` with generated SDK client
- UI-002: Adopt generated SDK (`sdk/ts`) across pages; remove manual `web/lib/sdk.ts` or wrap generated client
- UI-003: Implement Dashboard with counts/health panels
- UI-004: Add sorting to Bookmarks table
- UI-005: Build Feeds page (list/create/update/delete) and link relations
- UI-006: Add update forms for Credentials and Site Configs
- UI-007: Add purposeful empty states across tables and pages
- UI-008: Add dead-letter queue view under Jobs
- UI-009: Jobs streaming via WebSocket/SSE + pill notifications
- UI-010: Advanced Search (field-specific + regex) for Bookmarks
- UI-011: Add Sentry to UI (Next.js integration)
- UI-012: Add middleware to set `app.user_id` session var for RLS enforcement in Postgres
- UI-013: Expand i18n string catalog and wrap page text
- UI-014: Add component tests and minimal E2E (Playwright)
- UI-015: Admin health/status panels and System view (OpenAPI/metrics/version)
- UI-016: Keyboard shortcuts (`/`, `j/k`, `?`)
- UI-017: Preview pane for article content
- UI-018: Tags & folders management for Instapaper
- UI-019: Retry/backoff policy in client with exponential backoff
- UI-020: Backpressure UI for bulk actions (rate limit feedback)

