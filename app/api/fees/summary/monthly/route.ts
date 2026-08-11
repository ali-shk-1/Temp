import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { normalizeMonthInput } from '@/lib/fees-helpers';

/* ─────────────────────────────────────────
   GET /api/fees/summary/monthly?month=YYYY-MM
   Ported from routes/fees.js `GET /summary/monthly`.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const month = normalizeMonthInput(req.nextUrl.searchParams.get('month')) || `${new Date().toISOString().slice(0, 7)}-01`;

    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        TO_CHAR(${month}::DATE, 'Month YYYY') AS month_label,
        (SELECT COUNT(*) FROM fee_payments
          WHERE DATE_TRUNC('month', academic_month) = DATE_TRUNC('month', ${month}::DATE)) AS payment_count,
        (SELECT COALESCE(SUM(amount_due), 0) FROM fee_payments
          WHERE DATE_TRUNC('month', academic_month) = DATE_TRUNC('month', ${month}::DATE)) AS total_due,
        (SELECT COALESCE(SUM(amount_paid), 0) FROM fee_payments
          WHERE DATE_TRUNC('month', COALESCE(payment_date, academic_month)) = DATE_TRUNC('month', ${month}::DATE)) AS total_paid,
        (SELECT COALESCE(SUM(amount_due - amount_paid), 0) FROM fee_payments
          WHERE DATE_TRUNC('month', academic_month) = DATE_TRUNC('month', ${month}::DATE)) AS total_balance
    `;

    const row = rows[0];
    const shaped = row
      ? { ...row, payment_count: parseInt(row.payment_count.toString(), 10) }
      : { month_label: null, payment_count: 0, total_due: 0, total_paid: 0, total_balance: 0 };

    return NextResponse.json(shaped);
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
