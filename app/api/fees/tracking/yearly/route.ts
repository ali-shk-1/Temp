import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   GET /api/fees/tracking/yearly?year=YYYY
   Ported from routes/fees.js `GET /tracking/yearly`.
   One row per month with student-count + totals, for the year toggle view.

   This is the "Fee Tracking" (A) view: bills FOR each calendar month
   (academic_month), regardless of which month it was actually paid in.
   Student count is based on who was billed for that month, not who
   happened to pay something in it.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const year = req.nextUrl.searchParams.get('year') || String(new Date().getFullYear());

    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        TO_CHAR(month_date, 'Mon YYYY') AS month_label,
        month_date,
        student_count,
        total_due,
        total_paid,
        (total_due - total_paid) AS total_balance
      FROM (
        SELECT
          DATE_TRUNC('month', fp.academic_month) AS month_date,
          COUNT(DISTINCT fp.student_id) AS student_count,
          SUM(fp.amount_due)  AS total_due,
          SUM(fp.amount_paid) AS total_paid
        FROM fee_payments fp
        WHERE EXTRACT(YEAR FROM fp.academic_month) = ${parseInt(year, 10)}
        GROUP BY DATE_TRUNC('month', fp.academic_month)
      ) t
      ORDER BY month_date
    `;

    const shaped = rows.map((r) => ({
      ...r,
      student_count: parseInt(r.student_count.toString(), 10),
    }));

    return NextResponse.json(shaped);
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
