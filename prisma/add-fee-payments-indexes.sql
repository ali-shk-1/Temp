-- add-fee-payments-indexes.sql
--
-- Adds indexes to fee_payments to speed up the Fee Tracking, Student
-- Tracking, student profile, monthly defaulters, and daily report
-- pages — all of which filter/join on student_id and/or academic_month,
-- which currently have no index (confirmed against
-- prisma/reference-schema-dump.sql).
--
-- SAFE TO RUN: this script only CREATEs indexes. It does not alter,
-- delete, move, or lock out reads/writes of any existing row in
-- fee_payments or any other table. Uses IF NOT EXISTS so it's safe to
-- re-run. CONCURRENTLY avoids taking a write-lock on the table while
-- the index builds, so the app can keep reading/writing fee_payments
-- normally while this runs (slightly slower to build, but zero
-- downtime — the standard safe approach on a live table).
--
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction
-- block, so run this file as-is (not wrapped in BEGIN/COMMIT), e.g.:
--   psql "$DATABASE_URL" -f prisma/add-fee-payments-indexes.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS fee_payments_student_id_idx
  ON public.fee_payments (student_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS fee_payments_academic_month_idx
  ON public.fee_payments (academic_month);

CREATE INDEX CONCURRENTLY IF NOT EXISTS fee_payments_student_id_academic_month_idx
  ON public.fee_payments (student_id, academic_month);
