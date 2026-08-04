-- Adds an optional email address to students so fee payment receipts
-- and notifications can be sent to enrolled students or their parents.

BEGIN;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS email VARCHAR(255);

COMMIT;
