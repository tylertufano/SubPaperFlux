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
