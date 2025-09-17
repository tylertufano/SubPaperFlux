# User Management Rollout Plan

This document outlines how to introduce granular user and role management without disrupting existing operators. The rollout is split into three phases with explicit feature flag guardrails and a defined migration order so that we can stage risk and quickly revert if necessary.

## Dependencies

Before entering Phase A ensure the following foundational work has landed in production deployments:

- Users/roles data model (new tables, associations, and seed data for the default operator role).
- Session variable middleware that populates `current_user_id`, `current_role`, and audit context on every request.

## Feature Flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `user_mgmt_core` (`USER_MGMT_CORE`) | `off` | Enables persistence and API endpoints for managing users and role assignments.
| `user_mgmt_ui` | `off` | Surfaces the management UI (list, create, assign roles) in the admin area.
| `user_mgmt_enforce` | `off` | Enforces role-based access control (RBAC) checks on protected endpoints.

Each flag can be enabled independently per environment. Turning a flag off should always return the system to the prior behavior.

`USER_MGMT_CORE` is read from the process environment. Set it to `1`, `true`, `yes`, or `on` to expose the `/v1/admin/users` and `/v1/admin/audit` routers and to allow OIDC auto-provisioning to run when `OIDC_AUTO_PROVISION_USERS` is also enabled. Leave it unset (or any other value) to keep those endpoints hidden and skip auto-provisioning entirely.

## Migration Order

1. **Deploy database migrations** adding the users/roles schema and backfilling a superuser linked to the existing operator account.
2. **Roll out backend services** with all three feature flags defaulted to `off` to confirm the new schema is read-only compatible.
3. **Progress through Phases A–C** below, validating telemetry and support feedback before proceeding to the next step.

## Phase A — Backend & Data Readiness (`user_mgmt_core`)

**Goal:** Ship the underlying APIs and storage so that we can begin internal testing.

1. Apply any remaining data migrations for role seeds or audit triggers.
2. Enable `user_mgmt_core` in staging to exercise CRUD endpoints and confirm audit trails via the new session middleware.
3. Once verified, enable the flag in production but limit use to internal admins via API tokens or scripts.
4. Monitor logs for migration regressions (foreign key violations, missing session context) for at least one release cycle before moving to Phase B.

**Rollback plan:** Disable `user_mgmt_core` and revert to the pre-rollout API behavior. Existing user records remain dormant until the flag is re-enabled.

## Phase B — Management UI (`user_mgmt_ui`)

**Goal:** Allow trusted operators to manage accounts through the UI while RBAC checks remain permissive.

1. With Phase A stable, enable `user_mgmt_ui` in staging. Validate list pagination, creation flows, and role assignment modals.
2. Update runbooks to include UI-driven account provisioning and deactivation steps.
3. Enable the UI flag for a pilot group in production, keeping `user_mgmt_enforce` disabled so legacy admin actions still succeed.
4. Collect usability feedback and confirm that audit logs capture UI-triggered changes with the session middleware context.

**Rollback plan:** Toggle `user_mgmt_ui` off to hide the UI while leaving API access from Phase A intact.

## Phase C — RBAC Enforcement (`user_mgmt_enforce`)

**Goal:** Enforce role-based permissions for all user-triggered actions.

1. Confirm role matrices are complete and that every API handler checks the session variables populated by the middleware.
2. Enable `user_mgmt_enforce` in staging along with automated regression suites that cover critical flows (bookmarks, jobs, credentials).
3. Stage production rollout by enabling enforcement for internal staff first, then gradually for all tenants.
4. Instrument alerts for permission denials so we can identify missing allow-list entries or misconfigured roles quickly.

**Rollback plan:** Disable `user_mgmt_enforce` to return to permissive access while keeping the data model and UI from earlier phases available.

## Post-Rollout Tasks

- Expand documentation for tenant onboarding, including role recommendations and least-privilege examples.
- Evaluate whether feature flags can be removed or replaced with configuration once adoption stabilizes.
- Schedule a cleanup migration to remove temporary fallbacks in handlers that assume enforcement is disabled.
