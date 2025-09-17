# Testing Guidelines

This project uses Playwright-based end-to-end (E2E) smoke tests to validate that the administrative web UI can authenticate, seed data through the API, and exercise core user flows.

## E2E Test Layout
- **Specs:** Located under [`web/e2e/`](../web/e2e/) with `*.spec.ts` files. The default suite (`smoke.spec.ts`) covers creating a Miniflux credential, previewing seeded bookmarks, and verifying the bulk delete workflow against a stubbed Instapaper payload.
- **Fixtures:** [`web/e2e/fixtures/`](../web/e2e/fixtures/) provides shared helpers:
  - `test`/`expect` extend Playwright with an embedded OIDC stub so UI tests run fully offline.
  - `ApiHelper` seeds and cleans up API data (credentials, bookmarks, jobs) using the authenticated context.
  - `OidcStub` issues tokens for the configured test user and exposes helpers to customize claims or groups when scenarios require different authorization rules.
- **Setup:** [`web/playwright.config.ts`](../web/playwright.config.ts) configures a single Chromium project, records traces on retries, and retains videos for failed tests.

## When to Add or Update Tests
- Add a new spec when you build a new end-user flow (e.g., credential management, bookmark tools, job monitoring) or significantly change the behavior of existing pages or APIs.
- Update existing tests when you modify selectors, button labels, or API payloads referenced by the smoke flow to keep the suite aligned with the UI.
- Expand fixture helpers if new API endpoints or authentication behaviors are needed to seed state efficiently.

## Extending the Suite
1. Create a new `*.spec.ts` under `web/e2e/` and import utilities from `./fixtures`.
2. Use the provided `api` fixture to programmatically create or clean up data instead of relying on UI-only setup.
3. Call `OidcStub#setUser` (via the `testUser` fixture) to simulate different roles or group memberships when validating RBAC scenarios.
4. Prefer `test.step` blocks to make failures easier to diagnose in the Playwright trace viewer.
5. Run tests locally with `npm run test:e2e -- --headed` to iterate interactively, then re-run with `--headless` (or `CI=1`) to ensure the flow passes under CI conditions.

Following these guidelines keeps the smoke coverage meaningful and helps future contributors grow the E2E suite alongside new features.
