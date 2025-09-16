# UI Roadmap

This roadmap now includes live status checkboxes and a reusable TODO reference. Use it to track progress and drive future prompts.

Status legend: [x] done, [~] in progress, [ ] todo

## Phase 0 — Foundations

- [x] Auth (OIDC): Secure login via provider; session handling; token refresh. (UI-022)
  - Evidence: `web/pages/api/auth/[...nextauth].ts:1`
- [x] Design System: Tailwind CSS + Headless patterns. (UI-023)
  - Evidence: `web/tailwind.config.js:1`, `web/styles/globals.css:1`
- [x] Routing/Layout: App shell with nav, breadcrumbs, responsive breakpoints. (UI-024)
  - Evidence: `web/components/Nav.tsx:1`, Next.js pages in `web/pages`
- [x] SDK Integration: Use generated TypeScript SDK + typed models for API calls (UI-002).
  - [x] Centralized wrapper around generated SDK in `web/lib/openapi.ts`
  - [x] Generated SDK present in `sdk/ts`
  - [x] Pages migrated to generated SDK; removed legacy helpers (`web/lib/api.ts`, `web/lib/sdk.ts`) (UI-002)
- [x] Error + Empty States: Friendly messages, retry actions, contact link (UI-007).
  - Evidence: `web/components/EmptyState.tsx:1`, `web/pages/bookmarks.tsx:315`, `web/pages/feeds.tsx:116`
  - [x] Alerts component exists: `web/components/Alert.tsx:1`
  - [x] Purposeful empty states across pages (UI-007)
- [x] State & Caching: SWR for caching/retries/refresh. (UI-025)
  - Evidence: `web/package.json:15`, `web/pages/*:1`
- [x] Accessibility: Semantic markup, focus states, ARIA, color contrast checks (UI-030).
  - Evidence: `web/components/Nav.tsx:83`, `web/components/DropdownMenu.tsx:37`, `web/styles/globals.css:6`
  - [x] Add ARIA and contrast audits (UI-030, UI-032)
    - Evidence: `web/components/DropdownMenu.tsx:73`, `web/styles/globals.css:16`
- [x] i18n-Ready: Wrap text for translation; locale switch scaffold (UI-013).
  - Evidence: `web/lib/i18n.tsx:1`, `web/locales/en/common.json:1`
  - [x] Minimal provider: `web/lib/i18n.tsx:29`
  - [x] Expand string catalog beyond Nav/Home (UI-013)
    - Evidence: `web/pages/bookmarks.tsx:24`, `web/locales/en/common.json:1`

## Phase 1 — Core UX (MVP)

- [x] Dashboard (UI-003)
  - [x] Counts and quick links on Home: `web/pages/index.tsx:1`
- [x] Bookmarks (UI-021)
  - [x] Pagination, search, filters, fuzzy toggle: `web/pages/bookmarks.tsx:1`
  - [x] Bulk delete and export (JSON/CSV)
  - [x] Sorting (UI-004)
    - Evidence: `app/routers/bookmarks.py:1`, `web/pages/bookmarks.tsx:1`
- [x] Jobs
  - [x] Status filter, list, details flyout with payload/errors: `web/pages/jobs.tsx:1`
  - [x] Backoff timer and dedupe badges
  - [x] Retry and Retry All failed/dead
- [x] Credentials (UI-056)
  - [x] List, create, delete
  - [x] Test Instapaper/Miniflux
  - [x] Update forms with validation and tooltips; merge secrets safely (UI-006)
    - Evidence: `app/routers/credentials.py:1`, `web/pages/credentials.tsx:1`
- [x] Site Configs (UI-057)
  - [x] List, create, delete
  - [x] Test login
  - [x] Update forms with inline validation (UI-006)
    - Evidence: `web/pages/site-configs.tsx:1`
- [x] Feeds (UI-005)
  - [x] List page and CRUD (used for selection only)
    - [x] List
    - [x] Create
    - [x] Delete
    - [x] Update (UI-077)
- [x] Admin (UI-015)
  - [x] PG prep (pg_trgm/indexes) and enable RLS: `web/pages/admin.tsx:12`
  - [x] Health/status panels and system info (UI-015)
  - [x] Granular results and privilege hints; disable actions if not Postgres (UI-085)
    - Evidence: `app/db_admin.py:1`, `web/pages/admin.tsx:12`

## Phase 1.5 — Harden and Accelerate

### Integrate the generated TypeScript SDK

- [x] Export OpenAPI and generate SDK (UI-002)

```sh
make openapi-export API_BASE=http://localhost:8000
make sdk-ts
```

- [x] Replace `web/lib/api.ts` calls with generated SDK client and types (UI-001)
- [x] Centralize auth injection (Bearer token) via configuration

### Generated SDK (vendored in web)

- [x] Vendor generated client under `web/sdk` and update imports (UI-078)
- [x] Wrap generated client in `web/lib/openapi.ts` for auth/CSRF and future retries (UI-079)
- [x] Update Docker/CI to include `web/sdk` in context (UI-080)
- [x] Migrate pages from thin fetch wrapper to generated client + types (UI-079)
- [x] Remove temporary fetch-only fallback once migration completes (UI-081)
- [ ] Optional: publish `@subpaperflux/sdk` to npm and consume from package (UI-082)
 - [ ] Optional: add separate CI job matrix to validate SDK modes (regen vs copy) and artifact reuse (UI-083)

### Runtime-configurable API Base

- [x] Resolve API base at runtime via `/ui-config` and window override; warn on mixed content (UI-084)

### Add CRUD forms (Credentials + Site Configs)

- [x] Create/delete forms
- [x] Update forms with validation, tooltips, and masked secrets (UI-006)
- [x] CSRF header for cookie-mode auth
- [x] Never echo secrets in UI logs

### Add fuzzy search toggle for bookmarks

- [x] Use the `fuzzy=true` param to leverage Postgres trigram similarity sorting

### Add basic i18n

- [x] Provider + locale switch
- [ ] Extract core strings and page text (UI-013)

### Testing

- [ ] Component tests for filters/pagination and form validations (UI-014)
- [ ] Minimal E2E: login → create credential → test → list bookmarks → bulk delete (dry-run) (UI-014)

### Queue/Idempotency UX

- [x] Show dedupe feedback when publish is skipped
- [x] Surface job backoff timers and `last_error`
- [x] Retry All failed/dead
- [x] Dead-letter queue view (UI-008)

## Phase 2 — Power Features

- [x] Saved Views (Bookmarks)
- [x] Advanced Search: Field-specific (`title:`/`url:`), regex (PG only), similarity sort (UI-010)
  - Evidence: `sdk/ts/src/apis/BookmarksApi.ts`, `web/pages/bookmarks.tsx`
- [ ] Bulk Actions (UI-027)
  - [x] Delete/export
  - [~] Publish; progress modals (UI-028)
    - [x] Bulk publish modal component: `web/components/BulkPublishModal.tsx:1`
    - [x] API streaming per-item status: `app/routers/bookmarks.py:560`
 - [ ] Tags & Folders (UI-018)
 - [ ] Preview Pane (sanitized HTML) (UI-017)
 - [x] Jobs Streaming (WebSocket/SSE) (UI-009)
- [ ] Activity Log (UI-029)

## Optional / Recommended

### Accessibility (a11y)

- [x] Expand ARIA labeling (inputs, alerts) (UI-030)
  - Evidence: `web/pages/credentials.tsx:94`, `web/components/Alert.tsx:12`
- [x] Keyboard navigation patterns (focus traps) (UI-031)
  - Evidence: `web/components/DropdownMenu.tsx:43`
- [ ] Color contrast audits and dark mode (UI-032)

### Internationalization (i18n)

- [x] Expand string catalog beyond Nav/Home (UI-033)
  - Evidence: `web/locales/en/common.json:1`, `web/pages/index.tsx:45`
- [ ] Locale detection and formatting (dates, numbers) (UI-034)

### Observability

 - [ ] Per-endpoint histograms and job durations (UI surfacing) (UI-045)
 - [ ] Sentry client for UI and better grouping (UI-011)

### Security

 - [ ] DB RLS: Set `app.user_id` per DB session (middleware) (UI-012)
- [x] CSRF: UI sends `X-CSRF-Token`

### API Polish

- [ ] Uniform error responses (`application/problem+json`) (UI-036)
 - [x] SSE/WebSockets for jobs to remove polling (UI-009)

## Phase 3 — Onboarding & Guidance

- [ ] Setup Wizard (UI-037)
- [ ] Inline Tips (UI-038)
- [ ] Templates Gallery (UI-039)

## Phase 4 — Multi-User & Sharing

- [ ] RBAC UI (UI-040)
- [ ] Global Assets (copy to my workspace) (UI-041)
- [ ] Org Views / user management (if not delegated to IdP) (UI-042)

## Phase 5 — Observability & Ops

- [ ] Metrics View (Prometheus in UI) (UI-043)
- [ ] Health Console (integration checks, rate-limit insights) (UI-044)

### Admin & System

- [x] PG Prep: Buttons for `pg_trgm`/indexes; result details
 - [ ] RLS: Enable/disable with warnings; doc links (UI-046)
  - [ ] System View: OpenAPI doc link, metrics endpoint, version (UI-015)

## UX Details

- [ ] Consistency: Standard pagination (`page`/`size`), sorting, search input patterns (UI-047)
 - [ ] Keyboard Shortcuts: `/` focus search; `j/k` navigate; `?` help (UI-016)
 - [ ] Empty States: Templates/onboarding actions instead of blank tables (UI-007)
- [x] Confirmation: Dangerous actions gated (bulk delete)
- [ ] Responsive: Card layouts on mobile; advanced filters in Drawer (UI-048)

## Security & Privacy

- [x] Token Handling: Use access token only; never store secrets client-side
- [x] CSRF: If cookie-mode auth to API, include `X-CSRF-Token`
- [x] CORS: Configurable allowlist in API
- [x] PII: Mask secrets at API; UI never logs sensitive fields

## Performance & Robustness

 - [x] Retry Policies: Network retry with exponential backoff in SDK (UI-019)
 - [ ] Backpressure: Disable/enqueue bulk buttons if rate limits hit; show wait times (UI-020)
- [ ] Optimistic UX: Deletes/retries optimistic with reconciliation (UI-049)

## Testing & Quality

- [ ] Unit: Component tests for filters, pagination, modals (UI-014)
- [ ] Integration: Mock SDK to simulate API; test flows (UI-050)
 - [ ] E2E: Playwright/Cypress for login, CRUD, job retry, bulk delete (UI-014)
- [ ] Accessibility: Axe audits in CI; color contrast testing (UI-051)

## CI/CD & Ops

- [ ] Builds: Lint, type-check, unit tests, E2E smoke; bundle analysis (UI-052)
 - [ ] Envs: Dev/Stage/Prod with distinct OIDC + API base; feature flags (UI-053)
   - [x] Runtime API base resolution via `/ui-config` (UI-084)
- [ ] Error Reporting: Sentry client SDK; breadcrumb logs; user-friendly fallback (UI-011)
 - [ ] CI job matrix: validate both SDK generation modes (regen from OpenAPI vs copy vendored) (UI-083)

## Data Migrations & Compatibility

- [ ] API Compatibility: Use `/v1` endpoints only; track deprecations (UI-054)
- [ ] SDK Versioning: Lock SDK version per UI release; changelog/upgrade notes (UI-055)

## Rollout Plan

- Milestones: Phase 1 (2–3 sprints), Phases 2–3 (2–4 sprints), subsequent phases in parallel tracks (UI/BE/Ops)
- Feedback Loops: In-app feedback link; anonymized analytics to prioritize features

---

## Continued Enhancements: User Management

- Goals: Native users, roles, and admin controls alongside OIDC support.
- Strategy: Keep OIDC as primary; add first‑class users/roles for finer control and auditability.

### Scope

 - [ ] Users table and admin UI (UI-060)
 - [ ] Roles & RBAC with per‑resource ownership (UI-061)
 - [ ] OIDC group→role mapping with per-user overrides (UI-062)
 - [ ] Audit log for admin actions (UI-063)
 - [ ] API tokens (optional) (UI-064)
 - [ ] Quotas/policies per user (UI-065)
 - [ ] RLS enforcement: set `app.user_id` per DB session (UI-012)

### Integrations

 - [ ] OIDC‑only mode auto-provision (UI-066)
 - [ ] SCIM/Sync (optional) (UI-067)

### Data Model Additions

 - [ ] `users`, `roles`, `user_roles`, `audit_log`, `api_tokens` (UI-068)

### API Endpoints

 - [ ] `/v1/admin/users`, `/v1/admin/audit`, `/v1/me/tokens` (UI-069)

### UI

- [~] Users table, role badges, suspend/reactivate (UI-070)
  - [x] Placeholder page scaffolded: `web/pages/admin/users.tsx:1`
- [~] Audit filters and details (UI-071)
  - [x] Placeholder page scaffolded: `web/pages/admin/audit.tsx:1`
- [~] Token management UI (UI-072)
  - [x] Placeholder page scaffolded: `web/pages/me/tokens.tsx:1`

### Profile

- [~] Profile page (locale + preferences) (future)
  - [x] Placeholder page scaffolded: `web/pages/me.tsx:1`

### Security & Observability

 - [ ] Least privilege enforcement and confirmations (UI-073)
 - [ ] Metrics: `user_logins_total`, `admin_actions_total`, `api_tokens_issued_total` (UI-074)

### Dependencies & Rollout

 - [ ] DB migrations and session var middleware (UI-075)
 - [ ] Rollout: Phase A (users/roles), B (audit/metrics), C (tokens/SCIM) (UI-076)

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
- UI-010: Advanced Search (field-specific + regex) for Bookmarks — delivered with dedicated field filters, regex targeting, and relevance sort UI.
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
 - UI-022: OIDC authentication foundations
 - UI-023: Design system foundations (Tailwind + Headless)
 - UI-024: Routing/layout foundations (App shell + nav)
 - UI-025: State & caching foundations (SWR)
 - UI-021: Bookmarks module polish and remaining tasks
 - UI-027: Bulk actions meta (grouped execution UX)
 - UI-028: Publish action with progress modals
 - UI-029: Activity log (per-user audit trail)
 - UI-030: Accessibility ARIA labeling expansion
 - UI-031: Keyboard navigation patterns (focus traps, shortcuts)
 - UI-032: Color contrast audits and dark mode
 - UI-033: i18n string catalog expansion beyond Nav/Home
 - UI-034: Locale detection and formatting (dates, numbers)
 - UI-036: Uniform error responses (problem+json)
 - UI-037: Setup wizard (guided onboarding)
 - UI-038: Inline tips and contextual helpers
 - UI-039: Templates gallery (site-config presets)
 - UI-040: RBAC UI
 - UI-041: Global assets copy flow
 - UI-042: Org views and user management
 - UI-043: Metrics view (Prometheus charts in UI)
 - UI-044: Health console (integration checks, rate-limit insights)
 - UI-045: Per-endpoint histograms and job durations (UI surfacing)
 - UI-046: Admin RLS enable/disable with warnings
 - UI-047: UX consistency patterns
 - UI-048: Responsive layout improvements (drawers, mobile)
 - UI-049: Optimistic UX for deletes/retries
 - UI-050: Integration tests with mocked SDK
 - UI-051: Accessibility audits in CI (Axe, contrast)
 - UI-052: CI builds (lint, type-check, unit/E2E smoke, bundle analysis)
 - UI-053: Environment configs and feature flags (Dev/Stage/Prod)
 - UI-054: API compatibility policy (`/v1` only) and deprecation tracking
 - UI-055: SDK versioning policy and release notes
 - UI-056: Credentials module polish
 - UI-057: Site Configs module polish
  - UI-077: Add PUT /feeds/{id} endpoint (backend), regenerate SDK and wire UI update form
 - UI-060: Users table and admin UI
 - UI-061: Roles & RBAC data model
 - UI-062: OIDC group-to-role mapping
 - UI-063: Admin audit log
 - UI-064: Personal API tokens
 - UI-065: User quotas and policies
 - UI-066: OIDC-only auto-provision
 - UI-067: SCIM import/sync
 - UI-068: User management data model migrations
 - UI-069: Admin endpoints (/v1/admin/users, /v1/admin/audit, /v1/me/tokens)
 - UI-070: Users UI (role badges, suspend/reactivate)
 - UI-071: Audit UI (filters, drilldown)
 - UI-072: Token management UI
 - UI-073: Least-privilege enforcement with confirmations
 - UI-074: User management metrics
 - UI-075: Session var middleware + DB migrations
 - UI-076: User management rollout plan
  - UI-078: Vendor generated SDK under `web/sdk` and update imports
  - UI-079: Wrap generated client in `web/lib/openapi.ts`; migrate pages
  - UI-080: Docker/CI step to generate SDK or include vendored SDK
 - UI-081: Remove temporary fetch-only fallback
 - UI-082: Optionally publish `@subpaperflux/sdk` and adopt
 - UI-083: CI job matrix to validate SDK modes (regen vs copy) and artifact reuse
 - UI-084: Runtime API base resolution via `/ui-config` and mixed-content warning
 - UI-085: Admin privilege hints and Postgres-only safeguards
