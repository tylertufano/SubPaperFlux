# Error & Empty State Audit

Checklist of Next.js page routes that still need an `Alert` component or dedicated empty-state handling:

- [ ] /admin — lacks surfaced error/empty feedback around maintenance actions.
- [ ] /admin/audit — placeholder copy only; no alert or empty state for the audit log.
- [ ] /admin/users — placeholder copy only; no alert or empty state for user management.
- [ ] / — dashboard cards do not use shared alert or empty-state components.
- [ ] /me — profile placeholder without alert or empty-state coverage.
- [ ] /me/tokens — API token placeholder without alert or empty-state coverage.

Verified pages that already rely on `Alert` and `EmptyState` for reference:

- [x] /bookmarks — imports both components for error and empty cases.
- [x] /credentials — imports both components for error and empty cases.
- [x] /feeds — imports both components for error and empty cases.
- [x] /jobs — imports both components for error and empty cases.
- [x] /jobs-dead — imports both components for error and empty cases.
- [x] /site-configs — imports both components for error and empty cases.
