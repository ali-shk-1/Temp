-- 009_add_left_staff_and_role_visibility.sql
--
-- Adds:
--   1. left_staff table — mirrors left_students, for staff who leave.
--   2. role_page_visibility — sparse per-ROLE overrides of which nav
--      pages that role can see (e.g. hide "Staff" from principal).
--      Mirrors role_permissions exactly (same shape, same
--      ON CONFLICT DO NOTHING seeding pattern). Missing row = page
--      visible (fail-open on visibility; the underlying add/edit/delete
--      actions already fail-closed via role_permissions regardless).
--   3. New permission key: staff.leave (mirrors students.leave).
--
-- Run this once against your existing database:
--   psql -U postgres -d school_db -f migrations/009_add_left_staff_and_role_visibility.sql

BEGIN;

CREATE TABLE IF NOT EXISTS left_staff (
  left_staff_id   SERIAL PRIMARY KEY,
  old_staff_id    INTEGER,
  name            VARCHAR NOT NULL,
  cnic            VARCHAR,
  phone_no        VARCHAR,
  salary          NUMERIC,
  designation_id  INTEGER,
  designation     VARCHAR,   -- snapshot of the title at time of leaving, in case the designation is later deleted
  left_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  left_reason     TEXT
);

CREATE TABLE IF NOT EXISTS role_page_visibility (
  role_name   VARCHAR NOT NULL,
  page_key    VARCHAR NOT NULL,
  visible     BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_name, page_key)
);

-- Give admin/principal the same staff.leave default their staff.edit
-- already implied (they could already edit staff; "leave" is just a new
-- action alongside add/edit/delete, off by default until ali turns it on
-- for principal, matching how staff.* already defaults false for
-- principal since staff.js was previously admin-only).
INSERT INTO role_permissions (role_name, permission_key, allowed) VALUES
  ('admin', 'staff.leave', true),
  ('principal', 'staff.leave', false),
  ('viewer', 'staff.leave', false)
ON CONFLICT (role_name, permission_key) DO NOTHING;

COMMIT;

