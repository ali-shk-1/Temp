-- Migration: stop deleting receipts when their fee payment is deleted.
--
-- Currently payment_receipts.payment_id has a foreign key to
-- fee_payments.payment_id with ON DELETE CASCADE. This means deleting a
-- fee payment automatically deletes its receipt too. This migration
-- changes that to ON DELETE SET NULL, so the receipt survives (with
-- payment_id becoming NULL) as a permanent historical record, while the
-- fee payment row itself is still deleted normally.
--
-- The receipt already stores its own snapshot of student/amount/date at
-- issue time (student_name, roll_no, class, section, amount_due,
-- amount_paid, issued_at, etc.), so it remains fully meaningful even
-- after its originating payment is gone.
--
-- Safe to run on a live database with existing data — this only changes
-- FK behavior, it does not touch or delete any existing rows.

BEGIN;

-- 1. Drop the existing CASCADE constraint.
ALTER TABLE payment_receipts
  DROP CONSTRAINT payment_receipts_payment_id_fkey;

-- 2. Allow payment_id to be NULL (required for SET NULL to work).
ALTER TABLE payment_receipts
  ALTER COLUMN payment_id DROP NOT NULL;

-- 3. Re-add the constraint with SET NULL instead of CASCADE.
ALTER TABLE payment_receipts
  ADD CONSTRAINT payment_receipts_payment_id_fkey
  FOREIGN KEY (payment_id) REFERENCES fee_payments(payment_id)
  ON DELETE SET NULL;

COMMIT;
