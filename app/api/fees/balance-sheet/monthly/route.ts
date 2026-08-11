import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { normalizeMonthInput } from '@/lib/fees-helpers';

/* ─────────────────────────────────────────
   GET /api/fees/balance-sheet/monthly?month=YYYY-MM
   Ported from routes/fees.js `GET /balance-sheet/monthly`.
   One row per DAY within the given month, running totals reset at the
   start of that month.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const month = normalizeMonthInput(req.nextUrl.searchParams.get('month')) || `${new Date().toISOString().slice(0, 7)}-01`;

    const rows = await prisma.$queryRaw<any[]>`
      WITH days AS (
        SELECT generate_series(
          DATE_TRUNC('month', ${month}::DATE),
          (DATE_TRUNC('month', ${month}::DATE) + INTERVAL '1 month - 1 day'),
          INTERVAL '1 day'
        )::date AS day
      ),
      fee_by_day AS (
        SELECT DATE(COALESCE(payment_date, academic_month)) AS day,
               SUM(amount_paid) AS fee
        FROM fee_payments
        WHERE DATE_TRUNC('month', COALESCE(payment_date, academic_month)) = DATE_TRUNC('month', ${month}::DATE)
        GROUP BY DATE(COALESCE(payment_date, academic_month))
      ),
      expense_by_day AS (
        SELECT DATE(created_at) AS day,
               SUM(amount) AS expense
        FROM expenses
        WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', ${month}::DATE)
        GROUP BY DATE(created_at)
      )
      SELECT
        d.day,
        COALESCE(f.fee, 0)      AS fee,
        COALESCE(e.expense, 0)  AS expense,
        SUM(COALESCE(f.fee, 0))     OVER (ORDER BY d.day) AS total_fee,
        SUM(COALESCE(e.expense, 0)) OVER (ORDER BY d.day) AS total_expense,
        (COALESCE(f.fee, 0) - COALESCE(e.expense, 0)) AS balance,
        SUM(COALESCE(f.fee, 0) - COALESCE(e.expense, 0)) OVER (ORDER BY d.day) AS t_balance
      FROM days d
      LEFT JOIN fee_by_day f ON f.day = d.day
      LEFT JOIN expense_by_day e ON e.day = d.day
      ORDER BY d.day
    `;

    const last = rows[rows.length - 1];
    return NextResponse.json({
      month,
      days: rows,
      totals: {
        fee: last ? Number(last.total_fee) : 0,
        expense: last ? Number(last.total_expense) : 0,
        balance: last ? Number(last.t_balance) : 0,
      },
    });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
