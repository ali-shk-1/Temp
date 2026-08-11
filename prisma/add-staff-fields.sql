-- add-staff-fields.sql
--
-- Adds the new Staff fields (photo, joining date, category, optional
-- "under admin" self-relation) requested for the Staff form/table.
--
-- SAFE TO RUN: every statement below only ADDs a nullable column (or a
-- foreign key on a nullable column) with a sensible default where noted.
-- Nothing here alters, drops, or renames an existing column, and no
-- existing row's data changes — existing staff rows simply get NULL
-- (or, for joining_date, "today's date") in the new columns until you
-- fill them in via the updated Staff form.
--
-- NOTE: this file has two parts. The ALTER TABLE / constraint part runs
-- fine as a normal script. The CREATE INDEX CONCURRENTLY statements at
-- the bottom CANNOT run inside a transaction block, so if your psql
-- invocation wraps scripts in a transaction, run this file in two
-- pieces (or just run it with `psql -f`, which does not wrap DO blocks
-- and top-level statements in one single transaction by default).
--
-- Run with:
--   psql "$DATABASE_URL" -f prisma/add-staff-fields.sql

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS photo_url    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS joining_date DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS category     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS admin_id     INTEGER;

-- Self-referencing FK so a staff member can (optionally) be marked as
-- reporting to another staff member. ON DELETE SET NULL means deleting
-- an "admin" staff member doesn't cascade-delete their subordinates —
-- it just clears their admin_id back to unassigned.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_admin_id_fkey'
  ) THEN
    ALTER TABLE public.staff
      ADD CONSTRAINT staff_admin_id_fkey
      FOREIGN KEY (admin_id) REFERENCES public.staff(staff_id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Indexes (run separately from the block above if your client wraps
-- the whole file in one transaction — CONCURRENTLY requires running
-- outside any transaction) ──────────────────────────────────────────
-- Speeds up the "filter staff under a given admin" list-page filter,
-- and a category filter/lookup, both additive/non-destructive (same
-- reasoning as prisma/add-fee-payments-indexes.sql).
CREATE INDEX CONCURRENTLY IF NOT EXISTS staff_admin_id_idx ON public.staff (admin_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS staff_category_idx ON public.staff (category);

