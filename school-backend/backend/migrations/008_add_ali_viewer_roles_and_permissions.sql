-- Adds two new roles ("ali" and "viewer") and a role_permissions table that
-- backs the granular, ali-only-editable permission toggles.
--
-- - ali    : top of the hierarchy, always has every permission (enforced in
--            code, not stored here — see backend/permissions.js).
-- - viewer : read-only role. Every permission defaults to false, so a
--            viewer can navigate every page and see data, but cannot
--            add/edit/delete anything until ali turns something on.
--
-- role_permissions rows are only ever created for 'admin', 'principal',
-- and 'viewer' — ali is intentionally never given rows because it is
-- always all-true and not editable.
--
-- Run this once against your existing database:
--   psql -U postgres -d school_db -f migrations/008_add_ali_viewer_roles_and_permissions.sql

BEGIN;

INSERT INTO roles (role_name) VALUES ('ali')    ON CONFLICT (role_name) DO NOTHING;
INSERT INTO roles (role_name) VALUES ('viewer') ON CONFLICT (role_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_name       VARCHAR NOT NULL,
  permission_key  VARCHAR NOT NULL,
  allowed         BOOLEAN NOT NULL DEFAULT false,
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_name, permission_key)
);

-- Seed defaults that mirror the access admin/principal already had via
-- authorize(...) in the route files, so nothing changes for existing
-- accounts until ali actively edits a toggle. Viewer seeds all-false.
INSERT INTO role_permissions (role_name, permission_key, allowed) VALUES
  ('admin', 'students.add',          true),
  ('admin', 'students.edit',         true),
  ('admin', 'students.delete',       false),
  ('admin', 'students.leave',        true),
  ('admin', 'staff.add',             true),
  ('admin', 'staff.edit',            true),
  ('admin', 'staff.delete',          true),
  ('admin', 'staff.designations',    true),
  ('admin', 'fees.add',              true),
  ('admin', 'fees.edit',             true),
  ('admin', 'fees.delete',           true),
  ('admin', 'expenses.add',          true),
  ('admin', 'expenses.edit',         true),
  ('admin', 'expenses.delete',       true),
  ('admin', 'expenses.categories',   true),

  ('principal', 'students.add',        true),
  ('principal', 'students.edit',       true),
  ('principal', 'students.delete',     true),
  ('principal', 'students.leave',      true),
  ('principal', 'staff.add',           false),
  ('principal', 'staff.edit',          false),
  ('principal', 'staff.delete',        false),
  ('principal', 'staff.designations',  false),
  ('principal', 'fees.add',            true),
  ('principal', 'fees.edit',           true),
  ('principal', 'fees.delete',         true),
  ('principal', 'expenses.add',        false),
  ('principal', 'expenses.edit',       false),
  ('principal', 'expenses.delete',     false),
  ('principal', 'expenses.categories', false),

  ('viewer', 'students.add',          false),
  ('viewer', 'students.edit',         false),
  ('viewer', 'students.delete',       false),
  ('viewer', 'students.leave',        false),
  ('viewer', 'staff.add',             false),
  ('viewer', 'staff.edit',            false),
  ('viewer', 'staff.delete',          false),
  ('viewer', 'staff.designations',    false),
  ('viewer', 'fees.add',              false),
  ('viewer', 'fees.edit',             false),
  ('viewer', 'fees.delete',           false),
  ('viewer', 'expenses.add',          false),
  ('viewer', 'expenses.edit',         false),
  ('viewer', 'expenses.delete',       false),
  ('viewer', 'expenses.categories',   false)
ON CONFLICT (role_name, permission_key) DO NOTHING;

COMMIT;
