# User Management Rollout Guide

This guide outlines the operational steps required to enable the SCIM 2.0
provisioning endpoints and related user-management functionality.

## Prerequisites

* Ensure the application is deployed with the latest build that includes the
  SCIM router and configuration flags described below.
* Confirm that database migrations are up to date (no new migrations are
  required for SCIM itself).

## Enable the SCIM API

1. **Expose the API:**
   * Set the `SCIM_ENABLED=1` environment variable for the application.
   * Restart the application to ensure the FastAPI router cache picks up the
     new feature flag.
2. **Control write access (optional):**
   * To temporarily allow read-only validation, set `SCIM_WRITE_ENABLED=0`
     before enabling the router.
   * Re-enable writes by setting `SCIM_WRITE_ENABLED=1` once provisioning
     should be allowed.

## RBAC Considerations

* SCIM endpoints require an authenticated identity that already satisfies the
  administrator RBAC checks (`admin` role or equivalent permission).
* Integrations must present the same credentials used for existing admin API
  traffic (OIDC bearer tokens or the configured auth method).

## Validation Checklist

* Exercise the automated test suite (`pytest tests/test_scim_router.py`) to
  verify provisioning flows.
* Perform a manual end-to-end sync against a staging environment prior to
  production rollout.
* Monitor audit logs and metrics during the initial synchronization window to
  confirm successful operation.

## Phase 3A — Completion Checklist

- [ ] Apply all database migrations (`alembic upgrade head`) so the `User`,
  `Role`, and `UserRole` tables defined in `app/models.py` are available for
  provisioning flows.
- [ ] Verify system-role bootstrap by running
  `pytest tests/test_admin_users_router.py::test_admin_role_ensured_on_startup`;
  this ensures `ensure_admin_role` has seeded the admin role for downstream UI
  operations.
- [ ] Execute the admin API smoke tests
  (`pytest tests/test_admin_users_router.py tests/test_admin_roles_router.py
  tests/test_admin_orgs_router.py`) to confirm user, role, and organization
  endpoints align with the UI’s expectations.
- [ ] Confirm OIDC auto-provisioning and role mapping logic by running
  `pytest tests/test_auth_auto_provision.py tests/test_auth_mapping.py` before
  inviting external identities.
- [ ] Validate SCIM flag behaviour (`SCIM_ENABLED`, `SCIM_WRITE_ENABLED`) with
  `pytest tests/test_scim_router.py` whenever the provisioning API will be
  exposed.

## Phase 3B — Management UI Validation

- [ ] Load **Admin → Users** (`/admin/users`) and confirm the grid renders
  current identities, role badges, and override controls as defined in
  `web/pages/admin/users.tsx`.
- [ ] Exercise role assignment and revocation paths through the UI, ensuring
  audit events appear in **Admin → Audit Log** (`/admin/audit`), which is backed
  by the flows covered in `tests/test_admin_users_router.py`.
- [ ] Validate **Admin → Roles** (`/admin/roles`) management, ensuring system
  roles are locked per the behaviour covered in
  `web/__tests__/admin-roles.test.tsx`.
- [ ] Confirm organization filters and search helpers in **Admin → Orgs**
  (`/admin/orgs`) match expectations, and run `npm run test -- admin-orgs` to
  execute the targeted Vitest suite in `web/__tests__/admin-orgs.test.tsx`.
- [ ] Run `npm run test -- admin-rls` to execute the UI warnings/guardrails
  validated in `web/__tests__/admin-rls.test.tsx`, ensuring the management
  surface advertises RLS state correctly.

## Phase 3C — RBAC Enforcement

- [ ] Decide on the enforcement posture and set `USER_MGMT_CORE`,
  `USER_MGMT_ENFORCE`, `USER_MGMT_OIDC_ONLY`, and `USER_MGMT_RLS_ENFORCE`
  according to the guidance in `app/config.py`; document chosen values in your
  deployment runbook.
- [ ] Use **Admin → System** (`/admin`) to enable RLS owner policies and review
  the results table rendered by `web/pages/admin.tsx`, ensuring any warnings are
  resolved before proceeding.
- [ ] Run the RLS policy regression suite (`pytest tests/test_rls_policies.py`)
  followed by the permission matrix checks (`pytest
  tests/test_auth_permissions.py tests/test_feeds_v1_rbac.py`) to guarantee the
  database policies and API decorators match the intended scope.
- [ ] Confirm API-level enforcement by spot-checking sensitive endpoints with a
  non-privileged account (see `tests/test_admin_users_router.py` and
  `tests/test_feeds_v1_rbac.py` for the expected failure modes).
- [ ] After toggling enforcement flags, clear FastAPI/Next.js caches by
  restarting the API and web workers so new RBAC settings apply immediately.
