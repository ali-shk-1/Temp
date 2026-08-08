-- 016_add_vice_principal_and_accountant_roles.sql
--
-- Adds two new manageable roles: "vice_principal" and "accountant".
-- Both work exactly like admin/principal/viewer already do — ali can
-- toggle every individual permission and nav-page visibility for them
-- from the Permissions page, rename their account, and reset their
-- password. See permissions.js MANAGEABLE_ROLES / DEFAULT_PERMISSIONS
-- for the in-code source of truth these rows mirror.
--
-- vice_principal defaults mirror 'principal' (senior academic role).
-- accountant defaults focus on money pages (fees/receipts/expenses/
-- tracking) with no student/staff record rights by default.
--
-- Login accounts themselves (username/password) are created separately
-- via create-vice-principal.js / create-accountant.js — this migration
-- only creates the ROLE and its default permission rows, so running it
-- is safe even before those scripts are run, and re-running it is safe
-- afterward (ON CONFLICT DO NOTHING everywhere).
--
-- Run this once against your existing database:
--   node migrate.js
-- or:
--   psql -U postgres -d school_db -f migrations/016_add_vice_principal_and_accountant_roles.sql

BEGIN;

INSERT INTO roles (role_name) VALUES ('vice_principal') ON CONFLICT (role_name) DO NOTHING;
INSERT INTO roles (role_name) VALUES ('accountant')     ON CONFLICT (role_name) DO NOTHING;

INSERT INTO role_permissions (role_name, permission_key, allowed) VALUES
  ('vice_principal', 'students.add',          true),
  ('vice_principal', 'students.edit',         true),
  ('vice_principal', 'students.delete',       true),
  ('vice_principal', 'students.leave',        true),
  ('vice_principal', 'left-students.edit',    true),
  ('vice_principal', 'left-students.delete',  true),
  ('vice_principal', 'staff.add',             false),
  ('vice_principal', 'staff.edit',            false),
  ('vice_principal', 'staff.delete',          false),
  ('vice_principal', 'staff.leave',           false),
  ('vice_principal', 'staff.designations',    false),
  ('vice_principal', 'left-staff.edit',       false),
  ('vice_principal', 'left-staff.delete',     false),
  ('vice_principal', 'fees.add',              true),
  ('vice_principal', 'fees.edit',             true),
  ('vice_principal', 'fees.delete',           true),
  ('vice_principal', 'fees.custom_date',      false),
  ('vice_principal', 'receipts.add',          true),
  ('vice_principal', 'receipts.edit',         false),
  ('vice_principal', 'receipts.delete',       false),
  ('vice_principal', 'expenses.add',          false),
  ('vice_principal', 'expenses.edit',         false),
  ('vice_principal', 'expenses.delete',       false),
  ('vice_principal', 'expenses.categories',   false),
  ('vice_principal', 'tracking.add',          true),
  ('vice_principal', 'tracking.edit',         true),
  ('vice_principal', 'tracking.delete',       false),
  ('vice_principal', 'balance-sheet.add',     false),
  ('vice_principal', 'balance-sheet.edit',    false),
  ('vice_principal', 'balance-sheet.delete',  false),

  ('accountant', 'students.add',          false),
  ('accountant', 'students.edit',         false),
  ('accountant', 'students.delete',       false),
  ('accountant', 'students.leave',        false),
  ('accountant', 'left-students.edit',    false),
  ('accountant', 'left-students.delete',  false),
  ('accountant', 'staff.add',             false),
  ('accountant', 'staff.edit',            false),
  ('accountant', 'staff.delete',          false),
  ('accountant', 'staff.leave',           false),
  ('accountant', 'staff.designations',    false),
  ('accountant', 'left-staff.edit',       false),
  ('accountant', 'left-staff.delete',     false),
  ('accountant', 'fees.add',              true),
  ('accountant', 'fees.edit',             true),
  ('accountant', 'fees.delete',           true),
  ('accountant', 'fees.custom_date',      false),
  ('accountant', 'receipts.add',          true),
  ('accountant', 'receipts.edit',         true),
  ('accountant', 'receipts.delete',       false),
  ('accountant', 'expenses.add',          true),
  ('accountant', 'expenses.edit',         true),
  ('accountant', 'expenses.delete',       true),
  ('accountant', 'expenses.categories',   true),
  ('accountant', 'tracking.add',          true),
  ('accountant', 'tracking.edit',         true),
  ('accountant', 'tracking.delete',       true),
  ('accountant', 'balance-sheet.add',     false),
  ('accountant', 'balance-sheet.edit',    false),
  ('accountant', 'balance-sheet.delete',  false)
ON CONFLICT (role_name, permission_key) DO NOTHING;

COMMIT;
