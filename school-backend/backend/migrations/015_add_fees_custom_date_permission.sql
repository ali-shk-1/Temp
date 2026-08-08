-- 015_add_fees_custom_date_permission.sql
--
-- Seeds the new 'fees.custom_date' permission (added to permissions.js)
-- into role_permissions for admin, principal, and viewer, defaulting to
-- false for all of them — backdating a fee deposit to a different day is
-- ali-only until ali explicitly toggles it on for a role from the
-- Permissions page. This mirrors the pattern used in migration 008.
--
-- Not strictly required for the app to work (authMiddleware.can() falls
-- back to permissions.js's DEFAULT_PERMISSIONS when no row exists yet),
-- but inserting the row here means the Permissions page shows an
-- explicit, correct state immediately rather than relying on the
-- in-code fallback.
--
-- Run this once against your existing database:
--   node migrate.js
-- or:
--   psql -U postgres -d school_db -f migrations/015_add_fees_custom_date_permission.sql

BEGIN;

INSERT INTO role_permissions (role_name, permission_key, allowed) VALUES
  ('admin',     'fees.custom_date', false),
  ('principal', 'fees.custom_date', false),
  ('viewer',    'fees.custom_date', false)
ON CONFLICT (role_name, permission_key) DO NOTHING;

COMMIT;
