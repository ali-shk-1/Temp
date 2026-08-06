-- 010_preserve_fee_history_on_student_leave.sql
--
-- Fixes an inconsistency: staff.js's leave route preserves everything
-- (snapshots into left_staff, deletes nothing else), but students.js's
-- leave route permanently DELETEs the student's fee_payments rows with
-- no snapshot and no way to undo it. This adds a left_student_fee_payments
-- table that mirrors fee_payments' columns (plus a left_student_id link)
-- so routes/students.js can copy-then-delete instead of just delete,
-- matching the pattern already used for the student row itself
-- (left_students) and for staff (left_staff).
--
-- Run this once against your existing database:
--   psql -U postgres -d school_db -f migrations/010_preserve_fee_history_on_student_leave.sql

BEGIN;

CREATE TABLE IF NOT EXISTS left_student_fee_payments (
  left_fee_payment_id  SERIAL PRIMARY KEY,
  left_student_id      INTEGER NOT NULL REFERENCES left_students(left_student_id) ON DELETE CASCADE,
  old_student_id       INTEGER,
  academic_month       DATE,
  amount_due           NUMERIC,
  amount_paid          NUMERIC,
  payment_date         TIMESTAMP
);

COMMIT;
