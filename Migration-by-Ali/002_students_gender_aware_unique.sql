-- Migration: fix students uniqueness to be (gender, roll_no, class, section)
--
-- The live database currently only has the legacy 3-column constraint:
--   students_roll_no_section_class_key UNIQUE(roll_no, section, class)
--
-- This incorrectly blocks a boy and a girl from sharing the same
-- roll_no within the same class/section — which is intentional in this
-- school's data (roll numbers are assigned separately per gender).
--
-- The intended constraint (per original design / schema.prisma comments)
-- is a functional unique index on (class, section, gender, roll_no),
-- treating a NULL gender as 'unspecified' so it still enforces
-- uniqueness for students with no gender recorded:
--
--   CREATE UNIQUE INDEX students_class_section_gender_roll_no_unique
--     ON students (class, section, COALESCE(gender, 'unspecified'), roll_no);
--
-- This migration:
--   1. Drops the old legacy 3-column unique constraint (roll_no, section, class)
--   2. Adds the correct 4-column functional unique index including gender
--   3. Adds the CHECK constraint restricting gender to NULL/'male'/'female'
--      (also documented in schema.prisma but never applied)
--
-- Safe to run on a live database with existing data, AS LONG AS there are
-- no existing rows that would violate the new constraint (e.g. two boys
-- already sharing the same roll_no/class/section by mistake). Run the
-- pre-check query below first — if it returns any rows, resolve those
-- duplicates before running this migration.

-- ── Pre-check: run this SELECT first and confirm it returns 0 rows ────────
-- SELECT class, section, COALESCE(gender, 'unspecified') AS g, roll_no, COUNT(*)
-- FROM students
-- GROUP BY class, section, COALESCE(gender, 'unspecified'), roll_no
-- HAVING COUNT(*) > 1;

BEGIN;

-- 1. Drop the old legacy constraint that didn't account for gender.
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_roll_no_section_class_key;

-- 2. Add the correct functional unique index including gender.
CREATE UNIQUE INDEX IF NOT EXISTS students_class_section_gender_roll_no_unique
  ON students (class, section, COALESCE(gender, 'unspecified'), roll_no);

-- 3. Add the CHECK constraint restricting gender to NULL/'male'/'female'
--    (documented in schema.prisma but not yet applied to the live DB).
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_gender_check;
ALTER TABLE students ADD CONSTRAINT students_gender_check
  CHECK (gender IS NULL OR gender IN ('male', 'female'));

COMMIT;

-- After running this, also update prisma/schema.prisma's Student model to
-- reflect the new constraint (replace the @@unique([roll_no, section, class])
-- line), then run `npx prisma db pull` to confirm Prisma sees the change,
-- followed by `npx prisma generate`.
