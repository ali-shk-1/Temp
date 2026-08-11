import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   GET /api/expenses/reports/monthly-trend?year=YYYY
   Ported from routes/expenses.js `GET /reports/monthly-trend`.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const year = req.nextUrl.searchParams.get('year') || String(new Date().getFullYear());

    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        TO_CHAR(created_at, 'Mon YYYY') AS month_label,
        DATE_TRUNC('month', created_at) AS month_date,
        SUM(amount) AS total_amount,
        COUNT(*) AS transaction_count
      FROM expenses
      WHERE EXTRACT(YEAR FROM created_at) = ${parseInt(year, 10)}
      GROUP BY DATE_TRUNC('month', created_at), TO_CHAR(created_at, 'Mon YYYY')
      ORDER BY month_date
    `;

    const shaped = rows.map((r) => ({
      ...r,
      transaction_count: parseInt(r.transaction_count.toString(), 10),
    }));

    return NextResponse.json(shaped);
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
