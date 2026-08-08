-- 013_add_student_gender.sql
--
-- Adds a gender column to students and left_students so the frontend can
-- filter rosters (and every view derived from them) by Boys / Girls /
-- Both. Nullable and unconstrained on purpose: existing rows have no
-- gender recorded yet, and leaving it nullable means "unknown/not set"
-- rather than forcing a guess. The frontend treats null the same as
-- "unspecified" and such students still show up under the default
-- (unfiltered / "both") view.
--
-- Run this once against your existing database:
--   node migrate.js
-- or:
--   psql -U postgres -d school_db -f migrations/013_add_student_gender.sql

BEGIN;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS gender VARCHAR(10);

ALTER TABLE left_students
  ADD COLUMN IF NOT EXISTS gender VARCHAR(10);

-- Keep values consistent ('male' / 'female') if set, without forcing every
-- existing NULL row to pick one. CHECK constraints allow NULL through by
-- design in Postgres, so this only validates rows that DO have a value.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_gender_check'
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_gender_check
      CHECK (gender IS NULL OR gender IN ('male', 'female'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'left_students_gender_check'
  ) THEN
    ALTER TABLE left_students
      ADD CONSTRAINT left_students_gender_check
      CHECK (gender IS NULL OR gender IN ('male', 'female'));
  END IF;
END;
$$;

COMMIT;
