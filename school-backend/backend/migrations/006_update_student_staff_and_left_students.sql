BEGIN;

-- Ensure students.roll_no auto-increments for new records
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'students_roll_no_seq'
      AND n.nspname = 'public'
  ) THEN
    CREATE SEQUENCE students_roll_no_seq OWNED BY students.roll_no;
    ALTER TABLE students ALTER COLUMN roll_no SET DEFAULT nextval('students_roll_no_seq');

    PERFORM (
      SELECT CASE
        WHEN max_roll IS NULL THEN setval('students_roll_no_seq', 1, false)
        ELSE setval('students_roll_no_seq', max_roll, true)
      END
      FROM (SELECT MAX(roll_no) AS max_roll FROM students) AS t
    );
  END IF;
END;
$$;

-- Remove staff_code from staff, since staff are now identified by staff_id and CNIC
ALTER TABLE staff
  DROP COLUMN IF EXISTS staff_code;

-- Add left_students table for former students
CREATE TABLE IF NOT EXISTS left_students (
  left_student_id SERIAL PRIMARY KEY,
  old_student_id INTEGER,
  roll_no INTEGER,
  section VARCHAR,
  class VARCHAR,
  first_name VARCHAR NOT NULL,
  last_name VARCHAR NOT NULL,
  father_name VARCHAR,
  contact_1 VARCHAR,
  contact_2 VARCHAR,
  email VARCHAR,
  photo_url TEXT,
  address TEXT,
  admission_date DATE,
  left_date DATE NOT NULL DEFAULT CURRENT_DATE,
  left_reason TEXT
);

COMMIT;
