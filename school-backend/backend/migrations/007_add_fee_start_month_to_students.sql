BEGIN;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS fee_start_month DATE;

ALTER TABLE left_students
  ADD COLUMN IF NOT EXISTS fee_start_month DATE;

COMMIT;
