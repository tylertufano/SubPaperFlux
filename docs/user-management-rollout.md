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

### RBAC enforcement flag

`USER_MGMT_ENFORCE` is the process environment variable that controls the Phase C feature flag. The flag defaults to **off** when the variable is unset or contains any value other than `1`, `true`, `yes`, or `on`. When disabled, permission checks still run but API handlers fall back to permissive behavior—for example, global collections that require an admin role simply remain hidden instead of raising a `403`. Setting the variable to one of the truthy values switches the platform into enforcement mode so that every call to `has_permission`/`require_permission` will block unauthorized access with an HTTP 403 and surface audit events for denied actions.

The flag is evaluated lazily and cached via `app.config.is_user_mgmt_enforce_enabled()`, so remember to restart application processes after toggling it in long-running environments.

### Role to permission matrix

The default permission assignments live in [`app/auth/permissions.py`](../app/auth/permissions.py) and can be expanded without modifying callers. The matrix currently includes:

| Role | Permissions | Notes |
| --- | --- | --- |
| `admin` (`ADMIN_ROLE_NAME`) | `site_configs:read`, `site_configs:manage`, `credentials:read`, `credentials:manage`, `bookmarks:read`, `bookmarks:manage` | Grants every permission enumerated in `ALL_PERMISSIONS` and therefore full access to global resources. |

All other roles start with no elevated grants. The `has_permission` helper automatically allows users to manage resources they own (matching `owner_id`) even without explicit roles. To introduce a new role, add an entry to `ROLE_PERMISSIONS` that maps the role name to the set of permission constants to keep enforcement logic centralized.

**Rollback plan:** Disable `user_mgmt_enforce` to return to permissive access while keeping the data model and UI from earlier phases available.

## Mapping Configuration

Role assignments derived from identity provider groups are configured entirely through environment variables so that each tenant can align the UI with their IdP taxonomy without code changes. The backend consumes two knobs when resolving grants:

- `OIDC_GROUP_ROLE_MAP` defines a comma- or newline-separated list of `group=role` pairs. Multiple entries for the same group append additional roles to the set. The parser trims surrounding whitespace and rejects malformed tokens so operators get immediate feedback when a deployment starts (see `app/auth/mapping.py`).
- `OIDC_GROUP_ROLE_DEFAULTS` lists roles that should be granted to every auto-provisioned account regardless of group membership. These defaults seed the resolved role set before any mapped groups are evaluated (also in `app/auth/mapping.py`).

Auto-provisioning calls `resolve_roles_for_groups()` with the group claims pulled from the OIDC identity payload. That helper normalizes group names, applies the mapping/default configuration, and returns the deduplicated role set used downstream by `sync_user_roles_from_identity()` (see `app/auth/mapping.py` and `app/auth/provisioning.py`).

**Example configuration**

```
export OIDC_GROUP_ROLE_MAP="admins=admin\nops=publisher\nops=auditor"
export OIDC_GROUP_ROLE_DEFAULTS="reader"
```

With the sample above, any user in the `admins` group receives the `admin` role, and users in `ops` inherit both `publisher` and `auditor`. Everyone, including users in unmapped groups, is granted `reader` by default.

Reload application processes after changing either variable so the cached configuration is refreshed.

## Override Storage

Manual overrides let operators fine-tune role assignments when IdP data is incomplete or when they need to temporarily freeze automation. Overrides are persisted on each `User` record inside the JSON `claims` column under the `role_overrides` key. The payload captures three concepts: an `enabled` flag, a list of preserved roles, and a list of suppressed roles (see `app/models.py` and `app/auth/role_overrides.py`).

`RoleOverrides` objects enforce normalization (case-insensitive trimming, deduplication) and serialize back to JSON via `set_user_role_overrides()`. Clearing all fields removes the claim entirely. When identity synchronization runs, overrides alter the merge behavior: preserved roles are never revoked, suppressed roles are removed from IdP-derived grants, and toggling `enabled` prevents the automatic revocation path altogether until operators re-enable synchronization (see `app/auth/role_overrides.py` and `app/auth/provisioning.py`).

Admin APIs expose overrides through `/v1/admin/users/{user_id}/role-overrides` for updates and deletes so the UI and automation can toggle state without direct database access. Audit hooks emit events whenever overrides are changed, preserving traceability for compliance reviews (see `app/routers/admin_users_v1.py`).

## Operator Workflow

The admin UI surfaces overrides and mapping effects so support teams can manage accounts end-to-end once `user_mgmt_ui` is enabled:

1. Navigate to **Admin → Users** and locate the user via search, status, or role filters. Selecting a row opens the management drawer with quotas, roles, and override controls (implemented in `web/pages/admin/users.tsx`).
2. Review the **Role Overrides** card. The toggle indicates whether automatic revocations are paused, and the list shows preserved roles. Operators can add a preserved role using the inline form, remove entries, or clear the override entirely (see the `Role Overrides` section in `web/pages/admin/users.tsx`).
3. Saving changes invokes the admin override endpoints, refreshing the drawer state and flashing success or error alerts for immediate feedback. This keeps the UI synchronized with backend assertions and audit logs (see handlers in `web/pages/admin/users.tsx`).
4. After verifying the user's access, operators should test the IdP-driven mapping by re-running a login or calling the provisioning sync. Overrides ensure emergency access remains intact even if the identity payload changes unexpectedly (see `app/auth/provisioning.py`).

This workflow complements the group mapping configuration: operators rely on the environment-driven defaults for the majority of accounts while using overrides to handle exceptions without blocking the automated rollout.

## Post-Rollout Tasks

- Expand documentation for tenant onboarding, including role recommendations and least-privilege examples.
- ✅ Postgres admin operations now emit audit logs with actor metadata and action details, ensuring infrastructure toggles remain traceable.
- Evaluate whether feature flags can be removed or replaced with configuration once adoption stabilizes.
- Schedule a cleanup migration to remove temporary fallbacks in handlers that assume enforcement is disabled.
