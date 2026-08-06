-- Adds a new "principal" role.
--
-- The principal role is authorized for fee-related actions only
-- (record / edit / delete fee payments) — the same fee rights as
-- admin — but does NOT get admin's other rights (managing staff,
-- students, expense categories, or other user accounts). See
-- routes/fees.js `authorize(...)` calls for where this is enforced.
--
-- Run this once against your existing database:
--   psql -U postgres -d school_db -f migrations/003_add_principal_role.sql

BEGIN;

INSERT INTO roles (role_name) VALUES ('principal')
ON CONFLICT (role_name) DO NOTHING;

COMMIT;