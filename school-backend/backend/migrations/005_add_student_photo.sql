-- Adds an optional photo URL to student records so profile views and fee receipts
-- can show the student's picture when available.

BEGIN;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

COMMIT;
