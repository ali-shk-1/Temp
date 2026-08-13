# Fixes Applied This Session

This zip is the school-nextjs-final-merged app with all Part 1 and Part 2 items
from the handoff notes corrected, plus the Part 3-C timezone/DATE investigation
completed and fixed. Part 3-A (frontend audit) and Part 3-B (DB viewer) are
still outstanding — see original handoff notes for scope.

## Part 1 — Verified & (re-)applied (none were present in the zip received this session)

- A. `app/layout.tsx` — added `suppressHydrationWarning` to `<html>`.
- B. BigInt serialization — fixed in `fees/route.ts`, `fees/summary/monthly/route.ts`,
  `fees/tracking/yearly/route.ts`, `expenses/reports/by-category/route.ts`,
  `expenses/reports/monthly-trend/route.ts`. Swept all of `app/api` for `COUNT(`;
  confirmed no other instances (dashboard/route.ts already had the correct pattern).
- C. Date cast (`::DATE`) — fixed `expenses/route.ts` and
  `expenses/reports/by-category/route.ts` (`from` param). Swept all date-comparison
  interpolations across `app/api`; everything else was already cast correctly.
- D. `Prisma.Decimal` serialization — fixed all 8 originally-listed spots (fee
  payment PUT, expense POST/GET/PUT, staff GET/POST/PUT, staff-leave POST,
  left-staff GET list/PUT). Additionally checked two Decimal-bearing models not
  mentioned in the original notes (`LeftStudentFeePayment`, `PaymentReceipt`) —
  confirmed both are only ever accessed via `$queryRaw` or `createMany` (no
  Decimal-object leak), so no fix needed there.

## Part 2 — Fixed

1. Roll-number collision detection tightened in `students/route.ts` (POST) and
   `students/[id]/route.ts` (PUT) — now inspects `err.meta.target` for
   `roll_no`-related fields instead of trusting any `P2002` as a roll-no collision.
2. `old_student_id` — removed from the `leftStudent.create()` call in
   `students/[id]/leave/route.ts` to match the original's bug-for-bug NULL
   behavior (per the notes' stated default: exact parity over improvement).
3. JS-side search filtering in `students/route.ts` GET — left as-is per the
   notes (functionally identical, low priority, flagged only).

## Part 3-C — Investigated and fixed (was previously unstarted)

Confirmed the risk described in the handoff notes is real: Prisma's query
builder (`.findMany()`, `.findUnique()`, `.create()`, `.update()` — as opposed
to `$queryRaw`, which already returns date strings) returns `@db.Date` columns
as JS `Date` objects. `NextResponse.json()` serializes these via
`JSON.stringify`, which calls `.toISOString()` — a full UTC timestamp, not the
bare `'YYYY-MM-DD'` string the original's `pg` `setTypeParser(1082, ...)`
always sent. This is a real behavioral difference from the original and can
cause a day to appear to shift depending on how the frontend/downstream code
parses the value in a non-UTC-aware way.

Added `lib/date-format.ts` (`toDateOnlyString`, `withDateOnlyFields`) which
formats `@db.Date` fields back to plain `'YYYY-MM-DD'` strings before they hit
`NextResponse.json(...)`, exactly matching the original's wire format. Applied
to every query-builder response that includes a `@db.Date` field:

- `students/route.ts` (GET list, POST) — `admission_date`, `fee_start_month`
- `students/[id]/route.ts` (GET, PUT) — `admission_date`, `fee_start_month`
- `students/left/route.ts` (GET) — `admission_date`, `fee_start_month`, `left_date`
- `students/left/[id]/route.ts` (PUT) — `admission_date`, `fee_start_month`, `left_date`
- `fees/[payment_id]/route.ts` (PUT) — `academic_month`
- `expenses/route.ts` (POST) — `created_at`
- `expenses/[id]/route.ts` (GET, PUT) — `created_at`
- `staff/[id]/leave/route.ts` (POST) — `left_date`
- `staff/left/route.ts` (GET) — `left_date`
- `staff/left/[id]/route.ts` (PUT) — `left_date`

Confirmed `Staff` model has no `@db.Date` fields (only `Decimal` salary), so
`staff/route.ts` and `staff/[id]/route.ts` needed no date fix — verified by
reading the schema, not assumed.

All DELETE handlers across these routes were checked and confirmed safe: each
uses an explicit `select`/field list that excludes any `@db.Date` column.

## Build verification note

This sandbox's network allowlist doesn't reach `binaries.prisma.sh`, so
`prisma generate` and a full `next build` type-check could not be run here.
All edits were verified by: (1) brace-balance check across every edited file,
(2) manual line-by-line review of every diff against the original route logic,
and (3) confirming schema field types/nullability directly from
`prisma/schema.prisma` before writing each fix. Recommend running `npm install
&& npx prisma generate && npm run build` in an environment with full network
access before deploying, as a final sanity check.

## Not done this session (per priority order in original handoff notes)

- Part 3-A: frontend page-by-page audit (13 pages) — not started.
- Part 3-B: phpMyAdmin-style DB admin viewer — not started, net-new feature.
