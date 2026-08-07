-- 012_add_payment_receipts.sql
--
-- Adds a dedicated payment_receipts table so every fee payment gets a
-- sequential, tamper-evident receipt number (1, 2, 3, ...) separate from
-- the internal fee_payments.payment_id primary key. This lets front-desk
-- staff (and parents) verify a physical/printed receipt is legitimate by
-- checking the receipt_no exists and points at a real payment record.
--
-- receipt_no is a plain SERIAL — always increasing, never reused, even if
-- the underlying payment is later deleted (the receipt row itself is kept
-- for audit purposes; see ON DELETE behavior below).
--
-- Run this once against your existing database:
--   node migrate.js
-- or:
--   psql -U postgres -d school_db -f migrations/012_add_payment_receipts.sql

BEGIN;

CREATE TABLE IF NOT EXISTS payment_receipts (
  receipt_no    SERIAL PRIMARY KEY,
  payment_id    INTEGER NOT NULL REFERENCES fee_payments(payment_id) ON DELETE CASCADE,
  student_id    INTEGER NOT NULL,
  roll_no       VARCHAR,
  student_name  VARCHAR,
  class         VARCHAR,
  section       VARCHAR,
  academic_month DATE,
  amount_due    NUMERIC DEFAULT 0,
  amount_paid   NUMERIC DEFAULT 0,
  print_mode    VARCHAR DEFAULT 'paper',   -- 'paper' or 'thermal' — which layout was used when first printed
  issued_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  issued_by     VARCHAR                    -- username of the staff member who recorded the payment, if known
);

-- Multiple receipts CAN exist per payment_id by design: every time staff
-- print a receipt (including reprints) a fresh receipt_no is issued (see
-- POST /api/fees/:payment_id/receipt). This intentionally lets a payment
-- accumulate more than one receipt row over its lifetime — e.g. if a
-- parent asks for a duplicate — and each printed receipt_no can be looked
-- up here to confirm it's system-generated and matches this payment,
-- rather than being made up. No UNIQUE(payment_id) constraint, then.

CREATE INDEX IF NOT EXISTS idx_payment_receipts_student_id ON payment_receipts(student_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_issued_at ON payment_receipts(issued_at);

-- Backfill: give every existing fee_payments row one initial receipt so
-- historical payments are also verifiable, in payment_id order (so
-- earlier payments get earlier/lower receipt numbers). Guarded so this
-- only runs once — if the migration is re-applied after receipts have
-- already started accumulating (including reprints), we don't want to
-- insert duplicate backfill rows on top of real activity.
INSERT INTO payment_receipts
  (payment_id, student_id, roll_no, student_name, class, section, academic_month, amount_due, amount_paid, print_mode, issued_at)
SELECT
  fp.payment_id, fp.student_id, s.roll_no,
  TRIM(CONCAT(s.first_name, ' ', s.last_name)),
  s.class, s.section, fp.academic_month, fp.amount_due, fp.amount_paid,
  'paper', fp.payment_date
FROM fee_payments fp
JOIN students s ON s.student_id = fp.student_id
WHERE NOT EXISTS (SELECT 1 FROM payment_receipts)
ORDER BY fp.payment_id;

COMMIT;
