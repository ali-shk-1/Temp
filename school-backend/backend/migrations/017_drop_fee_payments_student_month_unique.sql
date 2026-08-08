-- 017_drop_fee_payments_student_month_unique.sql
--
-- fee_payments has always been designed to hold MULTIPLE rows per
-- (student_id, academic_month) — see the comment in routes/fees.js
-- POST /api/fees: when a fee record already exists for a student+month,
-- a second/third/... payment is intentionally inserted as an ADDITIONAL
-- row (with amount_due=0) rather than updating the existing one, so
-- daily payment history stays intact while monthly totals are computed
-- via SUM() across every row for that student+month.
--
-- That design only works if there is NO unique constraint on
-- (student_id, academic_month). This database predates the tracked
-- migration history (fee_payments isn't created by any file in this
-- migrations/ folder), and apparently still carries a legacy UNIQUE
-- constraint/index on (student_id, academic_month) from an earlier
-- version of the schema — which silently blocks every second payment
-- in the same month with a raw Postgres "duplicate key value violates
-- unique constraint" error (surfaced to users as a generic "Duplicate
-- entry" message by middleware/errorHandler.js's 23505 handler).
--
-- This migration finds and drops any such constraint/index by
-- INSPECTING pg_constraint / pg_index (rather than guessing a specific
-- name), so it works regardless of what the legacy constraint happens
-- to be called in your database. It only touches a UNIQUE constraint/
-- index whose columns are EXACTLY (student_id, academic_month) — it
-- will not touch the primary key or any other index (e.g. the
-- performance indexes on student_id or payment_date alone).
--
-- Run this once against your existing database:
--   node migrate.js
-- or:
--   psql -U postgres -d school_db -f migrations/017_drop_fee_payments_student_month_unique.sql

BEGIN;

DO $$
DECLARE
  rec RECORD;
BEGIN
  -- Case 1: a real UNIQUE (or PRIMARY KEY) table constraint on exactly
  -- (student_id, academic_month), in either column order.
  FOR rec IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'fee_payments'
      AND con.contype IN ('u', 'p')
      AND (
        SELECT array_agg(a.attname::text ORDER BY a.attname::text)
        FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
      ) = ARRAY['academic_month','student_id']::text[]
  LOOP
    EXECUTE format('ALTER TABLE fee_payments DROP CONSTRAINT %I', rec.conname);
    RAISE NOTICE 'Dropped constraint % on fee_payments', rec.conname;
  END LOOP;

  -- Case 2: a plain UNIQUE INDEX (not backed by a table constraint) on
  -- exactly the same two columns — e.g. created via
  -- CREATE UNIQUE INDEX ... ON fee_payments (student_id, academic_month)
  -- rather than an ALTER TABLE ... ADD CONSTRAINT.
  FOR rec IN
    SELECT ic.relname AS indexname
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_class tc ON tc.oid = i.indrelid
    WHERE tc.relname = 'fee_payments'
      AND i.indisunique
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid
      )
      AND (
        SELECT array_agg(a.attname::text ORDER BY a.attname::text)
        FROM unnest(i.indkey::int[]) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = k.attnum
      ) = ARRAY['academic_month','student_id']::text[]
  LOOP
    EXECUTE format('DROP INDEX %I', rec.indexname);
    RAISE NOTICE 'Dropped unique index % on fee_payments', rec.indexname;
  END LOOP;
END;
$$;

COMMIT;
