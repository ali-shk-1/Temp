-- Adds admission_date to students so defaulter calculations know
-- when a student actually joined, instead of assuming everyone
-- was enrolled since the beginning of time.
--
-- Run this once against your existing database:
--   psql -U postgres -d school_db -f migrations/002_add_admission_date.sql

BEGIN;

ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_date DATE;

-- Backfill existing students: use the earliest fee payment record we
-- already have for them as a best guess of when they joined. If a
-- student has no fee history at all, fall back to today so they don't
-- retroactively become "always enrolled" (which would make them a
-- defaulter for months before they existed in the system).
UPDATE students s
SET admission_date = COALESCE(
  (SELECT MIN(fp.academic_month) FROM fee_payments fp WHERE fp.student_id = s.student_id),
  CURRENT_DATE
)
WHERE admission_date IS NULL;

ALTER TABLE students ALTER COLUMN admission_date SET DEFAULT CURRENT_DATE;
ALTER TABLE students ALTER COLUMN admission_date SET NOT NULL;

COMMIT;
