# Testing Guidelines

The Next.js workspace uses Vitest for component-level regression coverage and Playwright for end-to-end smoke verification. This document lists the suites that must remain green and explains how to extend them safely.

## Required Component Suites

### Filters and result management
- `web/__tests__/bookmarks-filters.test.tsx` exercises the bookmarks table filters, pagination, preview fetches, and bulk actions against SWR-backed mocks so that refinements to query parameters or table rendering do not regress list management.
- `web/__tests__/bookmarks-preview-navigation.test.tsx` guards keyboard navigation and preview loading for bookmarks, ensuring shortcuts and preview hydrations keep working when the layout changes.

### Form validation flows
- `web/__tests__/credentials-form.test.tsx` seeds mocked OpenAPI handlers and verifies credential creation, validation messaging, credential testing, and CRUD flows for Instapaper/Miniflux entries.
- `web/__tests__/site-configs-form.test.tsx` covers site configuration forms, including selector validation, success banners, and SWR mutations for listing and persisting login recipes.

### Accessibility smoke checks
- `web/__tests__/a11y/pages.a11y.test.tsx` renders the home, feeds, and bookmarks pages inside the shared `I18nProvider` and runs `jest-axe` to guarantee critical navigation remains accessible.

Keep these suites up to date whenever you touch the corresponding UI surfaces; they are the fast feedback layer before running E2E coverage.

## Baseline E2E Scenario

The Playwright smoke test in `web/e2e/smoke.spec.ts` must always pass. It bootstraps a stub Miniflux server, then:
1. Creates and tests a Miniflux credential via the UI, verifying the success banners and API payloads.
2. Seeds multiple bookmarks through the `ApiHelper` fixture.
3. Navigates to the bookmarks page to filter, preview, multi-select, and dry-run the bulk delete workflow, asserting the API payload matches the seeded bookmark IDs and that status banners update.

If this scenario breaks, the release is blocked until parity is restored.

## Adding New Tests

### Component and page tests
- Place new component/page specs under `web/__tests__` using `*.test.tsx` filenames; group related files by feature (e.g., bookmarks, credentials, jobs) to match existing suites.
- Prefer the shared helper in `web/__tests__/helpers/renderWithSWR.tsx` to render components. It wraps the UI with `I18nProvider`, resets the hoisted `useSWR` mock, and provides utilities such as `makeSWRSuccess` for deterministic SWR responses.
- Stub API clients with `vi.mock('../lib/openapi', () => ({ ... }))` and collect spies inside a `vi.hoisted` block so mocks survive module reloads across tests.
- Mock router context via `vi.mock('next/router', ...)` and, when needed, override component exports (such as layout chrome) to keep tests focused on the feature under test.

### Accessibility regression tests
- Store accessibility-focused specs inside `web/__tests__/a11y` and end filenames with `.a11y.test.tsx`.
- Use `renderWithSWR` or lightweight `vi.mock('swr', ...)` setups to supply deterministic data, then assert with `expect(await axe(container)).toHaveNoViolations()` (enabled globally via `web/vitest.setup.ts`).

### Playwright specs
- Add new E2E coverage under `web/e2e` with `*.spec.ts` files. Reuse the exported `test` from `web/e2e/fixtures` to inherit the OIDC stub, authenticated context, and `ApiHelper` utilities for seeding/cleanup.
- Wrap multi-step flows in `test.step` blocks to improve trace readability, and perform cleanup in `try/finally` sections using the helper methods (`api.deleteBookmark`, `api.deleteCredential`, etc.).
- Prefer `page.route` and fixture utilities over bespoke mocks so API assertions remain consistent with production traffic.

## Running Tests Locally

1. From the repository root, `cd web` and install dependencies if needed: `npm install`.
2. Run the full Vitest component suite (including accessibility smoke tests) once: `npm run test -- --run`.
3. To focus on accessibility specs only, use `npm run test:a11y -- --run`.
4. Before launching Playwright, ensure the API is running and export its base URL (for example, `export API_BASE=http://localhost:8000`). Then run `npm run test:e2e` for an interactive headed run or `npm run test:e2e -- --headless` to mirror CI.

Keeping these commands green locally will prevent CI regressions and make it easier for future contributors to extend coverage.
