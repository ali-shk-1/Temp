-- Adds a new "principal" role.
--
-- At the time this migration was written, principal was authorized for
-- fee-related actions only via routes/fees.js `authorize('admin',
-- 'principal')`, and did not get admin's other rights. That has since
-- changed: routes now use the granular can() middleware backed by
-- role_permissions (see migration 008), and principal's current
-- defaults there (permissions.js DEFAULT_PERMISSIONS.principal) also
-- grant full student rights (add/edit/delete/leave) alongside fees, on
-- top of ali being able to toggle any of it per-role from the
-- Permissions page. This comment is kept for history; for current
-- effective permissions, see permissions.js / the role_permissions table
-- rather than this file.
--
-- Run this once against your existing database:
--   psql -U postgres -d school_db -f migrations/003_add_principal_role.sql

BEGIN;

INSERT INTO roles (role_name) VALUES ('principal')
ON CONFLICT (role_name) DO NOTHING;

COMMIT;