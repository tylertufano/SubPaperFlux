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
  - [x] Tag & folder management widgets and filters (UI-018)
    - Evidence: `web/pages/bookmarks.tsx:70-120`, `web/pages/bookmarks.tsx:360-940`
- [x] Jobs
  - [x] Status filter, list, details flyout with payload/errors: `web/pages/jobs.tsx:1`
  - [x] Backoff timer and dedupe badges
  - [x] Retry and Retry All failed/dead
- [x] Credentials (UI-056)
  - [x] List, create, delete
  - [x] Collect Instapaper username/password, fetch the OAuth token + secret automatically on the user's behalf, and persist credentials—no manual token pasting
    - Evidence: `app/routers/credentials.py:162-240`, `web/pages/credentials.tsx:64-88`
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

*Follow-up SDK distribution and CI matrix work now lives under Phase 5 — Observability & Operations.*

### Runtime-configurable API Base

- [x] Resolve API base at runtime via `/ui-config` and window override; warn on mixed content (UI-084)

### Add CRUD forms (Credentials + Site Configs)

- [x] Create/delete forms
- [x] Update forms with validation, tooltips, and masked secrets (UI-006)
- [x] CSRF header for cookie-mode auth
- [x] Never echo secrets in UI logs

### Add fuzzy search toggle for bookmarks

- [x] Use the `fuzzy=true` param to leverage Postgres trigram similarity sorting

### Add basic i18n foundations

- [x] Provider + locale switch
- Remaining string extraction and localization improvements continue in Phase 6 — Experience Polish & Adoption.

### Testing

- [x] Component tests for filters/pagination and form validations (UI-014)
  - Evidence: `web/__tests__/bookmarks-filters.test.tsx:1`, `web/__tests__/credentials-form.test.tsx:1`, `web/__tests__/site-configs-form.test.tsx:1`
  - SWR mocking helpers live in `web/__tests__/helpers/renderWithSWR.tsx:1`
- [x] Integration tests for bookmark tag assignment and folder moves (UI-018)
  - Evidence: `tests/test_bookmarks_router.py:90-220, 257-618`
- [x] Preview pane sanitization + keyboard navigation tests (`web/__tests__/PreviewPane.test.tsx`, `web/__tests__/bookmarks-preview-navigation.test.tsx`)
- [x] Vitest coverage for bulk tag modal flows (UI-027)
  - Evidence: `web/__tests__/bulk-tags.test.tsx:1-200`
- [x] Vitest coverage for bulk folder modal flows (UI-027)
  - Evidence: `web/__tests__/bulk-folders.test.tsx:1-220`
- [ ] Minimal E2E: login → create credential → test → list bookmarks → bulk delete (dry-run) (UI-014)
  - Playwright smoke coverage is paused due to GitHub Actions limitations and will be revisited once the current research wraps.

### Queue/Idempotency UX

- [x] Show dedupe feedback when publish is skipped
- [x] Surface job backoff timers and `last_error`
- [x] Retry All failed/dead
- [x] Dead-letter queue view (UI-008)

### Security & Privacy Hardening

- [x] Token Handling: Use access token only; never store secrets client-side
- [x] CSRF: UI sends `X-CSRF-Token`
- [x] CORS: Configurable allowlist in API
- [x] PII: Mask secrets at API; UI never logs sensitive fields
- [x] DB RLS: Set `app.user_id` per DB session (middleware) (UI-012)
  - Evidence: `app/main.py:64`, `app/db.py:33`

## Phase 2 — Power Features

- [x] Saved Views (Bookmarks)
- [x] Advanced Search: Field-specific (`title:`/`url:`), regex (PG only), similarity sort (UI-010)
  - Evidence: `web/sdk/src/apis/BookmarksApi.ts:1`, `web/pages/bookmarks.tsx:1`
  - Evidence: Regenerated SDK clients and wrapper wiring — `sdk/ts/src/apis/BookmarksApi.ts:1`, `web/sdk/src/apis/BookmarksApi.ts:1`, `web/lib/openapi.ts:1`
- [x] Bulk Actions (UI-027)
  - [x] Delete/export
  - [x] Publish; progress modals (UI-028)
    - [x] API streaming per-item pending/success/failure updates: `app/routers/bookmarks.py:1152-1233`
    - [x] Bulk publish modal + progress components orchestrate streaming & cancellation: `web/components/BulkPublishModal.tsx:150-384`, `web/components/ProgressModal.tsx:1-120`
    - [x] Modal integration triggered from Bookmarks UI with reset between runs: `web/pages/bookmarks.tsx:640-720`
    - [x] Stream client + unit tests cover pending/failure handling: `web/lib/bulkPublish.ts:1-80`, `web/__tests__/bulkPublish.test.ts:18-60`
    - [x] UI tests covering success, failure, and cancellation flows: `web/__tests__/bulk-publish.test.tsx:1-240`
    - [x] API tests for stream success, failure, and cancellation: `tests/test_bookmarks_router.py:222-320`
  - [x] Bulk tag update API + SDK coverage
    - Evidence: `app/schemas.py:200-212`, `app/routers/bookmarks.py:824-938`, `sdk/ts/src/apis/BookmarksApi.ts:3113-3204`, `web/lib/openapi.ts:428-431`
  - [x] Bulk tag assignment modal + toolbar action with localized feedback and tests
    - Evidence: `web/components/BulkTagModal.tsx:1-200`, `web/pages/bookmarks.tsx:130-220`, `web/__tests__/bulk-tags.test.tsx:1-200`
  - [x] Bulk folder update API + SDK coverage
    - Evidence: `app/schemas.py:213-256`, `app/routers/bookmarks.py:939-1150`, `tests/test_bookmarks_router.py:405-618`, `sdk/ts/src/apis/BookmarksApi.ts:3205-3450`, `web/sdk/src/apis/BookmarksApi.ts:3205-3450`, `web/lib/openapi.ts:431-445`
  - [x] Bulk folder assignment modal + toolbar action with localized feedback and tests
    - Evidence: `web/components/BulkFolderModal.tsx:1-200`, `web/pages/bookmarks.tsx:640-940`, `web/__tests__/bulk-folders.test.tsx:1-200`
- [x] Tags & Folders (UI-018)
  - Evidence: `alembic/versions/0011_tags_and_folders.py:1`, `alembic/versions/0016_tag_folder_foreign_keys.py:1`, `app/models.py:200-240`
  - [x] API endpoints for tag and folder management plus bookmark associations: `app/routers/bookmarks.py:1`
  - [x] TypeScript SDK updated for tags/folders endpoints: `sdk/ts/src/apis/BookmarksApi.ts:1`, `web/sdk/src/apis/BookmarksApi.ts:1`
  - [x] Bookmarks listing filters by tag/folder with UI widgets and tests: `app/routers/bookmarks.py:340`, `web/pages/bookmarks.tsx:70-120`, `web/pages/bookmarks.tsx:360-940`, `tests/test_bookmarks_router.py:90-220`
- [x] Preview Pane (sanitized HTML) (UI-017)
  - Backend preview endpoint returns Bleach-sanitized snippets: `app/routers/bookmarks.py:70-170`, `tests/test_bookmarks_router.py:360-460`
  - Preview pane component renders sanitized markup safely: `web/components/PreviewPane.tsx:1-120`, `web/__tests__/PreviewPane.test.tsx:1-80`
  - Integrated preview pane into Bookmarks table with keyboard navigation: `web/pages/bookmarks.tsx:200-520`, `web/__tests__/bookmarks-preview-navigation.test.tsx:1-220`
- [x] Jobs Streaming (WebSocket/SSE) (UI-009)
- [x] Activity Log (UI-029)
  - Evidence (data + API): `alembic/versions/0012_audit_log.py:1`, `app/models.py:260`, `app/routers/admin.py:64-130`, `app/routers/admin_audit_v1.py:1-17`
  - Evidence (hooks + tests): `app/audit.py:1`, `app/routers/credentials.py:80-158`, `app/routers/site_configs.py:34-130`, `app/routers/bookmarks.py:520-1330`, `tests/test_audit_log.py:1-170`
  - Evidence (UI + SDK): `web/pages/admin/audit.tsx:1-320`, `web/__tests__/admin-audit.test.tsx:1-140`, `web/lib/openapi.ts:166-320`, `web/locales/en/common.json:187-368`, `web/sdk/src/apis/AdminApi.ts:50-425`

## Phase 3 — User Management & Sharing

Reference: [User Management Rollout Plan](docs/user-management-rollout.md).

### Rollout Milestones

- [x] Phase A — Backend & Data Readiness ([checklist](docs/user-management-rollout.md#phase-3a-completion-checklist))
- [x] Phase B — Management UI ([validation](docs/user-management-rollout.md#phase-3b-management-ui-validation))
- [x] Phase C — RBAC Enforcement ([enforcement](docs/user-management-rollout.md#phase-3c-rbac-enforcement))

### Backend Foundations

- [x] Backend models and migrations for users/roles/api tokens (UI-040)
  - Evidence: `app/models.py:15`, `alembic/versions/0013_users_roles_api_tokens.py:1`
- [x] RBAC helper utilities and seed defaults — `app/auth/__init__.py:1`, `app/seed.py:1`
- [x] Auto-provision users on first login with configurable default role (UI-040)
  - Evidence: `app/auth/provisioning.py:1`, `app/auth/users.py:1`
- [x] API tokens (optional) (UI-064)
  - Evidence: `web/pages/me/tokens.tsx:1`
- [x] Quotas/policies per user (UI-065)
  - Evidence: `app/util/quotas.py:1`, `app/routers/credentials.py:1`, `app/routers/site_configs.py:1`, `app/routers/feeds.py:1`, `app/routers/me_tokens_v1.py:1`, `web/pages/admin/users.tsx:1`, `tests/test_user_quotas.py:1`
- [x] Users table and admin UI (UI-060)
  - Evidence: `app/routers/admin_users_v1.py:1`, `app/schemas.py:259`, `web/pages/admin/users.tsx:1`
- [x] Audit log for admin actions (UI-063)
  - Evidence: `app/audit.py:1`, `app/models.py:265`, `alembic/versions/0012_audit_log.py:1`, `app/routers/admin_users_v1.py:1`

### Access Control & Org Management

- [x] Roles & RBAC with per-resource ownership (UI-061) — see [RBAC enforcement flag rollout notes](docs/user-management-rollout.md#rbac-enforcement-flag)
- [x] RBAC UI (UI-040)
- [x] OIDC group→role mapping with per-user overrides (UI-062)
  - Evidence (backend mapping & sync): `app/auth/mapping.py:1-71`, `app/auth/provisioning.py:55-140`
  - Evidence (override storage & APIs): `app/auth/role_overrides.py:1-174`, `app/routers/admin_users_v1.py:54-353`
  - Evidence (admin UI workflow): `web/pages/admin/users.tsx:1-210`, `web/pages/admin/users.tsx:839-1008`
- [x] Global Assets (copy to my workspace) (UI-041)
  - Evidence: `app/routers/credentials_v1.py:82-139`, `app/routers/site_configs_v1.py:117-190`, `tests/test_copy_global_assets.py:1-220`
- [x] Org Views / user management (if not delegated to IdP) (UI-042)
  - Evidence: `app/routers/admin_orgs_v1.py:1`, `web/pages/admin/orgs.tsx:1`, `docs/user-management-rollout.md#organization-management`
- [x] RLS enforcement: enforce per-table policies and verify `app.user_id` propagation end-to-end (UI-012)
  - Evidence: `app/db_admin.py:66-114`, `app/main.py:71-153`, `app/db.py:53-127`, `tests/test_rls_policies.py:212-354`
- [x] RLS: Enable/disable with warnings; doc links (UI-046)
  - Evidence: `app/main.py:71-153`, `web/pages/admin.tsx:82-196`, `web/locales/en/common.json:375-392`, `docs/user-management-rollout.md:80-144`

### Integrations

- [x] OIDC-only mode auto-provision (UI-066)
- [x] SCIM/Sync (optional) (UI-067)

## Phase 4 — Onboarding & Guidance

- [x] Setup Wizard (UI-037)
- [x] Inline Tips (UI-038)
- [x] Templates Gallery (UI-039)

## Phase 5 — Observability & Operations

### Monitoring & Telemetry

- [x] Per-endpoint histograms and job durations surfaced in UI (UI-045)
  - Evidence: `web/pages/admin/metrics.tsx:160-520`, `web/lib/openapi.ts:1343-1372`, `app/observability/metrics.py:1-80`
- [x] Sentry client for UI and better grouping (UI-011)
  - Evidence: `web/pages/_app.tsx:1-20`, `web/lib/sentry.ts:1-36`, `web/sentry.config.ts:1-60`, `web/next.config.js:1-40`
- [x] Prometheus counters for logins, admin actions, and API token issuance exposed via `/metrics`
  - Evidence: `app/observability/metrics.py:1`, `app/main.py:1`, `app/routers/admin_users_v1.py:1`, `app/routers/me_tokens_v1.py:1`

### Operational Consoles

- [x] Metrics View (Prometheus in UI) (UI-043)
  - Evidence: `web/pages/admin/metrics.tsx:160-520`, `web/__tests__/admin-metrics.test.tsx:1-120`
- [ ] Health Console (integration checks, rate-limit insights) (UI-044)
- [x] System View: OpenAPI doc link, metrics endpoint, version (UI-015)
  - Evidence: `web/pages/admin.tsx:200-240`, `app/main.py:260-300`, `app/schemas.py:130-150`

### Release & Distribution

- [~] Builds: Lint, type-check, unit tests, E2E smoke; bundle analysis (UI-052)
  - Linting, type checks, Vitest unit suites, and bundle analysis now run in CI; Playwright smoke coverage remains paused pending GitHub Actions research (`.github/workflows/docker_image.yml:1-160`, `web/package.json:6-15`).
- [x] Envs: Dev/Stage/Prod with distinct OIDC + API base; feature flags (UI-053)
  - [x] Runtime API base resolution via `/ui-config` (UI-084)
  - Evidence: `templates/env.dev.example:1-120`, `templates/env.stage.example:1-120`, `templates/env.prod.example:1-120`, `README.md:172-202`
- [x] CI job matrix: validate both SDK generation modes (regen from OpenAPI vs copy vendored) (UI-083)
- [ ] Publish `@subpaperflux/sdk` to npm and consume from package (UI-082) — deferred; optional once release cadence resumes
- [x] API Compatibility: Use `/v1` endpoints only; track deprecations (UI-054)
- [ ] SDK Versioning: Lock SDK version per UI release; changelog/upgrade notes (UI-055)

### Error Handling & Reliability

- [x] Uniform error responses (`application/problem+json`) (UI-036)
  - Evidence: `app/errors.py:1-80`, `app/main.py:42-180`

## Phase 6 — Experience Polish & Adoption

### Accessibility & Internationalization

- [x] Extract core strings and page text for localization (UI-013)
- [x] Color contrast audits and dark mode (UI-032)
- [x] Locale detection and formatting (dates, numbers) (UI-034)

### UX Refinements

- [ ] Consistency: Standard pagination (`page`/`size`), sorting, search input patterns (UI-047)
- [ ] Keyboard Shortcuts: `/` focus search; `j/k` navigate; `?` help (UI-016)
- [ ] Empty States: Templates/onboarding actions instead of blank tables (UI-007)
- [x] Confirmation: Dangerous actions gated (bulk delete)
- [ ] Responsive: Card layouts on mobile; advanced filters in Drawer (UI-048)

### Performance & Robustness

- [x] Retry Policies: Network retry with exponential backoff in SDK (UI-019)
- [ ] Backpressure: Disable/enqueue bulk buttons if rate limits hit; show wait times (UI-020)
- [ ] Optimistic UX: Deletes/retries optimistic with reconciliation (UI-049)

### Quality & Testing

- [ ] Unit: Component tests for filters, pagination, modals (UI-014)
- [ ] Integration: Mock SDK to simulate API; test flows (UI-050)
- [ ] E2E: Playwright smoke for login, credential creation/test, bookmark preview, and bulk delete dry-run (UI-014)
  - Coverage deferred until Playwright automation can return post–GitHub Actions research.
- [ ] Accessibility: Axe audits in CI; color contrast testing (UI-051)

## Rollout Plan

- Milestones: Phase 1 (2–3 sprints), Phase 2 (2–4 sprints) completed; upcoming Phases 3–6 span parallel UI/BE/Ops tracks.
- Feedback Loops: In-app feedback link; anonymized analytics to prioritize features.
