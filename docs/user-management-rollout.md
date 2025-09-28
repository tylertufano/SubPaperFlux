# User Management Deployment Guide

This document explains how the user-management stack is shipped, configured, and
operated now that all related capabilities are enabled by default. The APIs,
UI, and enforcement paths are always available unless operators explicitly opt
out via environment overrides. Use this guide as a runbook for deployments,
emergency toggles, and day-to-day administration.

## Dependencies

Ensure the following foundational work is in place before rolling out a new
build that includes user-management changes:

- Users/roles data model (new tables, associations, and seed data for the
  default operator role).
- Session variable middleware that populates `current_user_id`,
  `current_role`, and audit context on every request.
- Organizations and membership data model (`alembic` revision
  `0018_add_organizations`) seeded with a default tenant for legacy users.

## Default configuration and overrides

Leaving the deployment environment unconfigured exposes the entire
user-management surface area. Admin routers, enforcement helpers, and the React
interface boot with user management enabled and assume access should be
restricted according to the RBAC ruleset.

The flags remain available for staged rollbacks or selective disablement. They
are parsed with the helper in `app/config.py`, which treats `1`, `true`, `yes`,
`on` (case-insensitive) as truthy and falls back to the defaults in the table
below when a variable is unset or empty:

| Setting | Default | Purpose |
| --- | --- | --- |
| `user_mgmt_core` (`USER_MGMT_CORE`) | `on` | Exposes the `/v1/admin/users` and `/v1/admin/audit` routers, enables persistence for user and role records, and allows OIDC auto-provisioning. Set to a non-truthy value to hide the endpoints and skip provisioning. |
| `user_mgmt_ui` (`USER_MGMT_UI` / `NEXT_PUBLIC_USER_MGMT_UI`) | `on` | Surfaces the management UI (navigation, list/detail screens, role assignment flows) in the admin area. Set to `0`/`false` to hide the pages while leaving the backend reachable. |
| `user_mgmt_enforce` (`USER_MGMT_ENFORCE`) | `on` | Enforces role-based access control (RBAC) checks on protected endpoints. Disable to temporarily fall back to permissive behavior while leaving the UI/API available. |
| `user_mgmt_rls_enforce` (`USER_MGMT_RLS_ENFORCE`) | inherits from enforcement | Controls the automatic Postgres row-level security (RLS) bootstrap. When unset it mirrors `USER_MGMT_ENFORCE`; set explicitly to manage the startup hook independently. |

When an environment variable is set to `0`, `false`, `no`, or left as an empty
string, the system interprets it as disabled and immediately reflects the new
state on the next request (or process restart for cached helpers).

## Deployment checklist

1. Apply any outstanding database migrations, especially those that create or
   modify the user/role or organization tables.
2. Deploy the backend and frontend. No feature-flag coordination is required—
   the routers and UI will be live after the rollout.
3. Run smoke tests covering the admin APIs and UI surfaces to confirm the
   deployment picked up the schema and that RBAC enforcement behaves as
   expected.
4. If issues surface, use the environment overrides above to disable specific
   layers (`USER_MGMT_UI=0`, `USER_MGMT_CORE=0`, etc.) while triaging, then
   remove the override once resolved.

## Phase 3A completion checklist

Use this checklist to verify the backend prerequisites for Phase 3A are in
place before moving on to the UI and enforcement milestones:

- [x] Database migrations for the core user and role models are applied and in
  sync with the application ORM (`app/models.py`) and the initial Alembic
  revision (`alembic/versions/0001_initial.py`).
- [x] Quota enforcement is wired through the shared helpers and validated by
  automated coverage (`app/util/quotas.py`, `tests/test_user_quotas.py`).
- [x] Postgres row-level security bootstrap tasks are available to operators via
  the admin tooling (`app/db_admin.py`) and execute without errors in the target
  environment.

## Management UI validation

Run this validation pass whenever Phase B user-management UI work lands. The
goal is to ensure the admin surfaces behave as expected against a freshly
deployed backend and that regression coverage remains intact.

- `web/pages/admin/users.tsx`
  - Lists all users with accurate pagination, search, and role indicators.
  - Supports creating, editing, and disabling users with optimistic UI updates
    and error reporting through the shared alert system.
  - Enforces role assignment constraints and hides RBAC-only roles when
    enforcement is disabled.
- `web/pages/admin/orgs.tsx`
  - Renders organization tables with membership counts and detail drawers.
  - Allows creating and updating organization metadata, including slug
    validation and duplicate checks.
  - Handles membership invites/removals and reflects backend errors with inline
    field validation states.
- `web/pages/me/tokens.tsx`
  - Lists personal access tokens, including last-used timestamps and scopes.
  - Allows generating and revoking tokens with confirmation modals and success
    toasts.
  - Prevents re-displaying token secrets after creation and ensures revoked
    tokens disappear from the list on the next refresh.

## RBAC enforcement

RBAC is now enforced everywhere by default. `is_user_mgmt_enforce_enabled()`
returns `True` unless `USER_MGMT_ENFORCE` is explicitly set to a falsy value, so
all calls to `has_permission` / `require_permission` will block unauthorized
access and emit audit events. Setting `USER_MGMT_ENFORCE=0` reverts the
application to the previous permissive mode without removing the UI or APIs.

### Role to permission matrix

The default permission assignments live in
[`app/auth/permissions.py`](../app/auth/permissions.py) and can be expanded
without modifying callers. The matrix currently includes:

| Role | Permissions | Notes |
| --- | --- | --- |
| `admin` (`ADMIN_ROLE_NAME`) | `site_configs:read`, `site_configs:manage`, `credentials:read`, `credentials:manage`, `bookmarks:read`, `bookmarks:manage` | Grants every permission enumerated in `ALL_PERMISSIONS` and therefore full access to global resources. |

All other roles start with no elevated grants. The `has_permission` helper
automatically allows users to manage resources they own (matching `owner_id`)
even without explicit roles. To introduce a new role, add an entry to
`ROLE_PERMISSIONS` that maps the role name to the set of permission constants to
keep enforcement logic centralized.

### Enforcement validation guide

Run this checklist whenever RBAC enforcement changes are staged for release or
when investigating production incidents. It confirms the three pillars that
guard access—permission mappings, middleware defaults, and the automated RLS
coverage—remain intact.

1. **Permission checks** (`app/auth/permissions.py`)
   - Confirm new permissions are added to `ALL_PERMISSIONS` and grouped under
     the appropriate role in `ROLE_PERMISSIONS`.
   - Verify helper behavior by exercising `has_permission` /
     `require_permission` in unit tests or an interactive shell, ensuring that
     owners retain manage access to their own resources while unaffiliated roles
     are blocked.
   - If you introduce new resources, update the docstring examples so future
     readers understand how composite permissions are expected to behave.
2. **Middleware defaults** (`app/main.py`, `app/db.py`)
   - Ensure `is_user_mgmt_enforce_enabled()` and
     `is_user_mgmt_rls_enforce_enabled()` both default to `True` when the
     environment variables are unset, preserving the secure-by-default stance.
   - Confirm the request middleware still injects `current_user_id` and
     `current_role` into `request.state` **before** database sessions are
     created so RLS policies receive the right context.
   - Validate the database session hooks continue to copy the request context
     into `app.user_id` and related settings before issuing queries.
3. **Row-level security tests** (`tests/test_rls_policies.py`)
   - Run `pytest tests/test_rls_policies.py` to confirm the enforcement suite
     passes and that new policies include coverage for both allow and deny
     cases.
   - When tests fail due to missing policies, update the bootstrap helpers in
     `app/db.py` and extend the fixtures in the test module until they reflect
     the intended behavior.

## Postgres Row-Level Security

Row-level security (RLS) lets Postgres enforce ownership checks directly in the
database. Because enforcement defaults to enabled, deployments that connect to
Postgres will automatically attempt to apply the owner policies during startup
unless explicitly disabled.

### Prerequisites

- A Postgres deployment. The admin UI hides the bootstrap actions when the
  `/v1/status/db` backend is not Postgres.
- Database credentials with permission to run `ALTER TABLE ... ENABLE ROW LEVEL
  SECURITY` and `CREATE POLICY`. Superuser or table owner privileges are
  required; otherwise Postgres will return `must be owner of relation` or
  `permission denied` errors.
- Application middleware that populates the `app.user_id` session variable on
  every request. The rollout enables this whenever RLS enforcement is active
  (see `app/db.py`).

Run the **Prepare Postgres** admin action first when upgrading from an older
deployment. It installs the `pg_trgm` extension and recommended indexes so that
text search continues to work efficiently once RLS is active.

### Automatic enablement

With the defaults in place (`USER_MGMT_RLS_ENFORCE` unset), the FastAPI startup
hook invokes `enable_rls()` whenever the deployment targets Postgres. The hook
logs a structured summary for each managed table and downgrades to warnings if
privileges are missing so production traffic is not blocked.

Set `USER_MGMT_RLS_ENFORCE=0` to skip the startup hook while leaving RBAC in
place. This is useful during database maintenance windows or when staging RLS in
lower environments without elevated privileges.

### Enabling RLS manually

Two paths remain available for operators who prefer an explicit rollout:

1. **One-time admin action:** The **Enable RLS** button (or
   `POST /v1/admin/postgres/enable-rls`) runs `enable_rls()` with the active
   admin's credentials. The UI streams a JSON report indicating whether each
   table was altered and whether the `select`, `update`, and `delete` owner
   policies were created.
2. **Startup hook:** Re-enable the automatic path by setting
   `USER_MGMT_RLS_ENFORCE=1` (or any other truthy value) after verifying manual
   enablement works as expected.

Both paths are idempotent. It is safe to re-run the admin action or restart the
application after schema migrations or owner changes to ensure policies remain
in place. Because the UI cannot disable the policies once applied, read the
rollback guidance in [Disabling RLS](#disabling-rls-manual-rollback) before
moving forward in production.

### Disabling RLS (manual rollback)

Row-level security can only be removed with direct SQL. To revert the owner
policies:

1. Set `USER_MGMT_RLS_ENFORCE=0` (or unset it along with
   `USER_MGMT_ENFORCE`) so the startup hook does not re-apply policies on boot.
2. Run `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` for each managed table
   (`bookmark`, `credential`, `feed`, `job`, `siteconfig`, and `cookie`).
3. Drop the RLS policies created by `enable_rls()`:

   ```sql
   DROP POLICY IF EXISTS select_owner ON bookmark;
   DROP POLICY IF EXISTS mod_owner ON bookmark;
   DROP POLICY IF EXISTS del_owner ON bookmark;
   -- repeat for credential, feed, job, siteconfig, and cookie tables
   ```

4. Rerun the verification queries from the troubleshooting section to confirm
   `relrowsecurity = false` and that no lingering policies remain in
   `pg_policies`.

### Troubleshooting

- **Privilege errors:** `permission denied` or `must be owner` responses mean the
  connected database role cannot alter the table or create policies. Grant the
  role superuser access, switch to the table owner, or transfer ownership with
  `ALTER TABLE <table> OWNER TO <role>;` before retrying.
- **Verifying policies:** Inspect current policies with
  `SELECT schemaname, tablename, policyname, permissive, roles FROM pg_policies
  WHERE tablename IN ('bookmark','credential','feed','job','siteconfig','cookie');`
  and confirm `relrowsecurity` is `true` for each table via
  `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN
  ('bookmark','credential','feed','job','siteconfig','cookie');`.
- **Session variable checks:** RLS policies rely on
  `current_setting('app.user_id', true)`. In psql, run `SHOW app.user_id;` (or
  `SELECT current_setting('app.user_id', true);`) to confirm it is populated for
  requests that should be scoped. Use `RESET app.user_id;` after debugging
  sessions to avoid leaking the value between manual queries. The helper
  functions in `app/db.py` automatically set and reset this variable for API
  requests.
- **Unexpected rows returned:** If RLS appears to allow cross-tenant access,
  verify the `owner_user_id` columns were backfilled correctly and that your
  query is not running as a superuser (superusers bypass RLS by default).

## Identity claim enrichment

Many identity providers only place stable identifiers inside access tokens and
leave profile or group information to the UserInfo endpoint. When that happens,
the backend cannot derive names, email addresses, or group memberships directly
from the JWT and auto-provisioning ends up with empty role inputs. Export
`OIDC_USERINFO_ENDPOINT` with the absolute URL to your IdP's UserInfo route to
close the gap. The API replays the bearer token against that endpoint whenever a
decoded payload is missing key attributes, merges the returned claims, and reruns
the group/role resolution before calling provisioning. Frontend deployments
already follow this pattern; keeping the API in sync ensures users inherit the
expected roles even when access tokens are sparse.

## Mapping configuration

Role assignments derived from identity provider groups are configured entirely
through environment variables so that each tenant can align the UI with their
IdP taxonomy without code changes. The backend consumes two knobs when resolving
grants:

- `OIDC_GROUP_ROLE_MAP` defines a comma- or newline-separated list of
  `group=role` pairs. Multiple entries for the same group append additional
  roles to the set. The parser trims surrounding whitespace and rejects
  malformed tokens so operators get immediate feedback when a deployment starts
  (see `app/auth/mapping.py`). Group identifiers are normalized in a
  case-insensitive manner, so `Admins`, `admins`, and `ADMINS` all reference the
  same mapping entry.
- `OIDC_GROUP_ROLE_DEFAULTS` lists roles that should be granted to every
  auto-provisioned account regardless of group membership. These defaults seed
  the resolved role set before any mapped groups are evaluated (also in
  `app/auth/mapping.py`).

Auto-provisioning calls `resolve_roles_for_groups()` with the group claims pulled
from the OIDC identity payload. That helper normalizes group names, applies the
mapping/default configuration, and returns the deduplicated role set used
downstream by `sync_user_roles_from_identity()` (see `app/auth/mapping.py` and
`app/auth/provisioning.py`).

**Example configuration**

```
export OIDC_GROUP_ROLE_MAP="admins=admin\nops=publisher\nops=auditor"
export OIDC_GROUP_ROLE_DEFAULTS="reader"
```

With the sample above, any user in the `admins` group receives the `admin` role,
and users in `ops` inherit both `publisher` and `auditor`. Everyone, including
users in unmapped groups, is granted `reader` by default.

Reload application processes after changing either variable so the cached
configuration is refreshed.

The frontend can also pull human-friendly display names from the same identity
payload. Set `OIDC_DISPLAY_NAME_CLAIM` on the web deployment to the claim that
should populate the account menu (for example, `name` or a custom namespaced
attribute). When left unset the UI checks for common `display_name`
representations and falls back to the base profile name.

## Override storage

Manual overrides let operators fine-tune role assignments when IdP data is
incomplete or when they need to temporarily freeze automation. Overrides are
persisted on each `User` record inside the JSON `claims` column under the
`role_overrides` key. The payload captures three concepts: an `enabled` flag, a
list of preserved roles, and a list of suppressed roles (see `app/models.py` and
`app/auth/role_overrides.py`).

`RoleOverrides` objects enforce normalization (case-insensitive trimming,
deduplication) and serialize back to JSON via `set_user_role_overrides()`. Clearing
all fields removes the claim entirely. When identity synchronization runs,
overrides alter the merge behavior: preserved roles are never revoked, suppressed
roles are removed from IdP-derived grants, and toggling `enabled` prevents the
automatic revocation path altogether until operators re-enable synchronization
(see `app/auth/role_overrides.py` and `app/auth/provisioning.py`).

Admin APIs expose overrides through `/v1/admin/users/{user_id}/role-overrides`
for updates and deletes so the UI and automation can toggle state without direct
database access. Audit hooks emit events whenever overrides are changed,
preserving traceability for compliance reviews (see
`app/routers/admin_users_v1.py`).

## Operator workflow

The admin UI surfaces overrides and mapping effects so support teams can manage
accounts end-to-end. Because the feature is enabled by default, no additional
configuration is required to reach the management screens.

1. Navigate to **Admin → Users** and locate the user via search, status, or role
   filters. Selecting a row opens the management drawer with quotas, roles, and
   override controls (implemented in `web/pages/admin/users.tsx`).
2. Review the **Role Overrides** card. The toggle indicates whether automatic
   revocations are paused, and the list shows preserved roles. Operators can add
   a preserved role using the inline form, remove entries, or clear the override
   entirely (see the `Role Overrides` section in `web/pages/admin/users.tsx`).
3. Saving changes invokes the admin override endpoints, refreshing the drawer
   state and flashing success or error alerts for immediate feedback. This keeps
   the UI synchronized with backend assertions and audit logs (see handlers in
   `web/pages/admin/users.tsx`).
4. After verifying the user's access, operators should test the IdP-driven
   mapping by re-running a login or calling the provisioning sync. Overrides
   ensure emergency access remains intact even if the identity payload changes
   unexpectedly (see `app/auth/provisioning.py`).

This workflow complements the group mapping configuration: operators rely on the
environment-driven defaults for the majority of accounts while using overrides
to handle exceptions without blocking the automated rollout.

## Organization management

### Runtime configuration

Organization APIs and UI routes follow the same defaults as the rest of the
user-management stack. `/v1/admin/orgs` and the **Admin → Organizations** pages
are available immediately after deployment. If a tenant needs to hide these
surfaces temporarily, set `USER_MGMT_CORE=0` on the backend and/or
`USER_MGMT_UI=0` (or `NEXT_PUBLIC_USER_MGMT_UI=0`) on the frontend build.

### Data model overview

The organizations feature introduces two SQLModel tables defined in
`app/models.py`:

- `Organization` stores the tenant metadata (`id`, `slug`, `name`, optional
  `description`) plus an `is_default` flag and timestamps. Slugs and names are
  unique to avoid operator confusion.
- `OrganizationMembership` links users to organizations through a composite
  primary key on `(organization_id, user_id)` and cascades deletes so memberships
  follow their parent records.

Relationships on `User` expose `organizations()` and `organization_memberships`
collections, letting higher-level APIs serialize memberships without manual
joins. Audit helpers (`app/audit.py`) and Prometheus counters
(`app/observability/metrics.py`) wrap mutating operations to keep compliance and
observability aligned with other admin surfaces.

### Migration and rollout order

Apply Alembic revision `0018_add_organizations` after the credential description
migration (`0017_credential_description`). The migration creates both tables,
seeds the default organization, and backfills memberships for every existing
user so they retain access after row-level security is tightened. Because the
APIs are now live by default, coordinate deployments carefully—run migrations
before rolling out application pods or temporarily set `USER_MGMT_CORE=0` during
the rollout window if you need to stage the schema change ahead of the new
binary.

### Default-organization backfill and guardrails

Revision `0018_add_organizations` seeds the default organization using the
constants in `app/organization_defaults.py`, then enrolls all users in that
tenant. Runtime helpers such as `ensure_default_organization()` and
`ensure_default_organization_membership()` keep the default slug, name, and
membership intact during seeding or ad-hoc scripts (`app/seed.py`). Operators can
re-run these helpers if configuration drift occurs without manually crafting
SQL.

### Operator UI workflow

The admin sidebar exposes **Admin → Organizations** alongside other management
surfaces. From there operators can:

1. Search and filter organizations, open the detail drawer, and review membership
   counts (`web/pages/admin/orgs.tsx`).
2. Update metadata or delete non-default tenants via the drawer actions, with
   audit events and metrics emitted automatically (`app/routers/admin_orgs_v1.py`).
3. Add or remove members by submitting user IDs or email addresses; the UI will
   refresh membership lists and toast results for confirmation
   (`web/pages/admin/orgs.tsx`).
4. Use **Admin → Users** to confirm per-user memberships, adjust assignments
   inline, or clear organization links entirely while reviewing other account
   context (`web/pages/admin/users.tsx`).

This workflow keeps organization lifecycle management in the same surfaces admins
already use for roles and overrides, minimizing training overhead during
rollouts.

## Post-rollout tasks

- Expand documentation for tenant onboarding, including role recommendations and
  least-privilege examples.
- Monitor audit and observability dashboards after each deployment to confirm
  enforcement remains healthy.
- Capture incident-response steps for using the environment overrides so on-call
  engineers can quickly disable individual layers if a regression is detected.
- Schedule periodic reviews of role mappings, overrides, and organization
  memberships to ensure they reflect current business requirements.
