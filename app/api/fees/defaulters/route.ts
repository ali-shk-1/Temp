import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { normalizeMonthInput } from '@/lib/fees-helpers';

/* ─────────────────────────────────────────
   GET /api/fees/defaulters?month=YYYY-MM
   Ported from routes/fees.js `GET /defaulters`.
   defaulter = a real fee_payments row for the month with
   amount_paid < amount_due. No carrying forward of stale dues for
   months the student was never actually billed.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const month = normalizeMonthInput(req.nextUrl.searchParams.get('month')) || `${new Date().toISOString().slice(0, 7)}-01`;

    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        s.student_id, s.roll_no, s.first_name, s.last_name,
        s.class, s.section, s.contact_1, s.father_name, s.admission_date, s.photo_url,
        fp.amount_due, fp.amount_paid,
        (fp.amount_due - fp.amount_paid) AS balance,
        fp.payment_date
      FROM students s
      JOIN fee_payments fp
        ON fp.student_id = s.student_id
        AND DATE_TRUNC('month', fp.academic_month) = DATE_TRUNC('month', ${month}::DATE)
      WHERE fp.amount_due > 0
        AND fp.amount_paid < fp.amount_due
      ORDER BY balance DESC
    `;

    return NextResponse.json({ count: rows.length, month, defaulters: rows });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
