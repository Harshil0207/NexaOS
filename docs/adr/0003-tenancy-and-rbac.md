# ADR-0003: Session-scoped tenancy and permission-based RBAC

**Status:** accepted · **Date:** 2026-09-26

**Decision.** The active organisation is stored on the server-side session and re-validated against
`memberships` on every request. All org-owned tables carry `organization_id` and every query filters
on it; lookups of foreign ids return 404 (no existence oracle). Roles (Owner, Admin, Manager, Member)
map to explicit permissions in `packages/shared`; code checks permissions only. Non-owners can grant
only roles below their own; the last owner cannot be removed or demoted.

**Consequences.** Role or membership changes take effect on the next request. Adding a role means
editing one map. Postgres row-level security is a possible future defence-in-depth layer.
