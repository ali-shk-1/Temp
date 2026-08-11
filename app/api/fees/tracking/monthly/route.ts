import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { normalizeMonthInput } from '@/lib/fees-helpers';

/* ─────────────────────────────────────────
   GET /api/fees/tracking/monthly?month=YYYY-MM
   Ported from routes/fees.js `GET /tracking/monthly`.
   Groups fee_payments by the DATE the payment was actually made
   (payment_date), not the month it was billed for (academic_month).
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const month = normalizeMonthInput(req.nextUrl.searchParams.get('month')) || `${new Date().toISOString().slice(0, 7)}-01`;

    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        fp.student_id,
        DATE_TRUNC('month', fp.academic_month)::date AS academic_month,
        SUM(fp.amount_due)  AS amount_due,
        SUM(fp.amount_paid) AS amount_paid,
        MAX(fp.payment_date) AS last_payment_date,
        s.roll_no, s.first_name, s.last_name, s.class, s.section, s.gender, s.father_name
      FROM fee_payments fp
      JOIN students s ON s.student_id = fp.student_id
      WHERE DATE_TRUNC('month', COALESCE(fp.payment_date, fp.academic_month)) = DATE_TRUNC('month', ${month}::DATE)
      GROUP BY fp.student_id, DATE_TRUNC('month', fp.academic_month), s.roll_no,
               s.first_name, s.last_name, s.class, s.section, s.gender, s.father_name
      ORDER BY s.class, s.section, s.roll_no, academic_month
    `;

    const totals = rows.reduce(
      (acc, r) => {
        acc.total_paid += Number(r.amount_paid) || 0;
        acc.total_due += Number(r.amount_due) || 0;
        return acc;
      },
      { total_paid: 0, total_due: 0 }
    );
    (totals as any).total_balance = totals.total_due - totals.total_paid;

    return NextResponse.json({ count: rows.length, month, students: rows, totals });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
