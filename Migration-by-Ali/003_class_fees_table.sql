-- Migration: add class_fees table (global "Total Fee" per class).
--
-- Backs the new Fees -> "Total Fee" sub-page, where ali (and anyone
-- granted the new class-fees.* permissions) sets one total-fee amount
-- per class label (Playgroup, Nursery, Prep, 1..10, or any other class
-- string in use — class is free text here, matching students.class,
-- not an enum).
--
-- This total_fee is used only to compute and print the "discount" line
-- on receipts: discount = total_fee - amount_due for the student's
-- class. It does NOT change how fee_payments.amount_due/amount_paid or
-- balance are calculated anywhere else in the app — those remain
-- exactly as before. If no class_fees row exists for a student's
-- class, receipts simply omit the Total Fee / Discount lines and fall
-- back to the original Amount Due / Amount Paid / Balance layout.
--
-- Safe to run on a live database: this only adds a new table, it does
-- not touch any existing table or row.

BEGIN;

CREATE TABLE IF NOT EXISTS class_fees (
  class_fee_id SERIAL PRIMARY KEY,
  class        VARCHAR(20) NOT NULL UNIQUE,
  total_fee    NUMERIC(10, 2) NOT NULL,
  updated_at   TIMESTAMP NOT NULL DEFAULT now(),
  updated_by   VARCHAR(50)
);

COMMIT;

-- After running this, run `npx prisma generate` to regenerate the
-- Prisma client against the updated schema.prisma (ClassFee model).
