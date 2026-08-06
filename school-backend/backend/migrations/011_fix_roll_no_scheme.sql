BEGIN;

-- The application assigns roll_no per-class (see routes/students.js), not via
-- a global sequence. Migration 006 wired students.roll_no to a global
-- sequence (students_roll_no_seq) that the app never actually uses (roll_no
-- is always supplied explicitly on INSERT), leaving it as dead, unused
-- infrastructure that also risked producing duplicate roll numbers across
-- classes if it were ever relied on. Remove it.
ALTER TABLE students ALTER COLUMN roll_no DROP DEFAULT;

DROP SEQUENCE IF EXISTS students_roll_no_seq;

-- Guard against the race condition where two students added to the same
-- class at nearly the same time could both read the same MAX(roll_no) and
-- be assigned the same value. This constraint makes such a collision fail
-- at the database level instead of silently succeeding.
-- NOTE: if any duplicate (class, roll_no) pairs already exist in the data,
-- this will fail — resolve those duplicates manually before rerunning.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_class_roll_no_unique'
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_class_roll_no_unique UNIQUE (class, roll_no);
  END IF;
END;
$$;

-- Prevent duplicate CNICs across active staff. NOTE: if any duplicate,
-- non-null cnic values already exist, this will fail — resolve those
-- manually before rerunning. NULLs are unaffected (a UNIQUE constraint
-- allows any number of NULLs in Postgres).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_cnic_unique'
  ) THEN
    ALTER TABLE staff ADD CONSTRAINT staff_cnic_unique UNIQUE (cnic);
  END IF;
END;
$$;

COMMIT;
