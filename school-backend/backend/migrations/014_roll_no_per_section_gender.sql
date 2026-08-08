-- 014_roll_no_per_section_gender.sql
--
-- Changes roll number assignment/uniqueness scope from "per class" to
-- "per class + section + gender", so e.g. Class 1-A boys, 1-A girls,
-- 1-B boys, 1-B girls etc. each get their own independent 1, 2, 3...
-- sequence instead of sharing one counter across the whole class.
--
-- This only changes the UNIQUE constraint. Roll number assignment itself
-- (picking MAX(roll_no)+1 for the right scope) is done in application
-- code — see routes/students.js.
--
-- gender is nullable (migration 013), and a plain UNIQUE constraint
-- treats every NULL as distinct from every other NULL in Postgres — so
-- two students in the same class/section with no gender set could still
-- collide on roll_no undetected. We avoid that by indexing on
-- COALESCE(gender, 'unspecified') instead of gender directly, so
-- "ungendered" students in the same class/section share one well-defined
-- roll_no sequence rather than silently bypassing the uniqueness check.
--
-- Run this once against your existing database:
--   node migrate.js
-- or:
--   psql -U postgres -d school_db -f migrations/014_roll_no_per_section_gender.sql

BEGIN;

-- Drop the old class-only uniqueness constraint (from migration 011).
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_class_roll_no_unique;

-- NOTE: if any duplicate (class, section, gender, roll_no) rows already
-- exist in the data (e.g. two boys both "Roll 1" in the same
-- class+section from before this feature), this index creation will
-- fail — resolve those duplicates manually (renumber one of them) before
-- rerunning this migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'students_class_section_gender_roll_no_unique'
  ) THEN
    CREATE UNIQUE INDEX students_class_section_gender_roll_no_unique
      ON students (class, section, COALESCE(gender, 'unspecified'), roll_no);
  END IF;
END;
$$;

COMMIT;
