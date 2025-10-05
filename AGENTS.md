# Agent Instructions

## Repository-wide workflow checks
Before submitting a pull request, reproduce every CI validation locally:

1. **Python API suite**
   - Create/activate a Python 3.11 virtualenv.
   - Install deps: `pip install -r requirements.api.txt -r requirements.txt pytest`.
   - Run backend tests from the repo root: `pytest`.
   - When working with Postgres row-level security changes, export `TEST_POSTGRES_URL` and run `pytest tests/test_rls_policies.py -m postgres` after the main suite.

2. **OpenAPI + SDK parity**
   - Regenerate artifacts whenever API schemas change: `make openapi-export`, `make sdk-ts-web`, and `make sdk-vendor-web`.
   - Run `npm run build` inside `web/` with representative env vars (see workflow) to confirm the generated SDK compiles. Commit regenerated files and ensure `git status` is clean.

3. **Node/Next.js workspace**
   - From `web/`, install dependencies with `npm ci` (or `npm install` for iterative development).
   - Lint: `npm run lint`.
   - Type check: `npm run typecheck`.
   - Unit tests (Vitest): `npm run test:unit -- --run`.
   - Accessibility suite: `npm run test:a11y -- --run`.
   - Bundle analysis: `npm run analyze` (cleans/rewrites `web/analyze/`).
   - Production build: `npm run build`.

4. **Docker image build parity**
   - Ensure the previous steps succeed; the CI build job re-runs the SDK generation and `npm run build` before producing Docker images. Local verification prevents build failures.

## Testing conventions
- Keep the Vitest suites under `web/__tests__` green; they are the fast feedback layer while Playwright coverage is paused.
- Place new component/page tests under `web/__tests__` with descriptive filenames. Use helpers from `web/__tests__/helpers/renderWithSWR.tsx`.
- Accessibility specs live in `web/__tests__/a11y` and must call `expect(await axe(...)).toHaveNoViolations()`.

Following this checklist mirrors the GitHub Actions workflows (`docker_image.yml`, `sdk-parity.yml`, and `web-accessibility.yml`) so PRs land with clean CI runs.
