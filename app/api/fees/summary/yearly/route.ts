import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   GET /api/fees/summary/yearly?year=YYYY
   Ported from routes/fees.js `GET /summary/yearly`.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const year = req.nextUrl.searchParams.get('year') || String(new Date().getFullYear());

    // Grouped by the month the fee was BILLED FOR (academic_month).
    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        TO_CHAR(academic_month, 'Mon YYYY') AS month_label,
        DATE_TRUNC('month', academic_month) AS month_date,
        SUM(amount_due)  AS total_due,
        SUM(amount_paid) AS total_paid,
        SUM(amount_due - amount_paid) AS total_balance
      FROM fee_payments
      WHERE EXTRACT(YEAR FROM academic_month) = ${parseInt(year, 10)}
      GROUP BY DATE_TRUNC('month', academic_month), TO_CHAR(academic_month, 'Mon YYYY')
      ORDER BY month_date
    `;

    return NextResponse.json(rows);
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
