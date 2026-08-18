import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   GET /api/dashboard
   Ported from routes/dashboard.js `GET /`.

   Runs all KPI/chart queries concurrently (Promise.all), same as the
   original's parallel pool.query calls. Kept as raw SQL throughout since
   every query here is an aggregate (COUNT/SUM with conditional
   DATE_TRUNC filters) that the query builder can't express cleanly, and
   consistency with the /api/fees defaulters logic (see comment below)
   matters more than query-builder purity.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const currentMonth = `${new Date().toISOString().slice(0, 7)}-01`;
    const currentYear = new Date().getFullYear();

    const [
      studentsRes,
      staffRes,
      feesMonthRes,
      expensesMonthRes,
      defaultersRes,
      feesYearRes,
      expensesYearRes,
    ] = await Promise.all([
      prisma.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total FROM students`,
      prisma.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total FROM staff`,
      // "Fee Collected (Month)" here is tied to academic_month — the fee
      // period the charge is FOR — so both total_due and total_paid are
      // "this month's bill", regardless of which calendar month it was
      // actually paid in.
      prisma.$queryRaw<{ total_due: string; total_paid: string }[]>`
        SELECT COALESCE((
                 SELECT SUM(amount_due) FROM fee_payments
                 WHERE DATE_TRUNC('month', academic_month) = DATE_TRUNC('month', ${currentMonth}::DATE)
               ), 0) AS total_due,
               COALESCE((
                 SELECT SUM(amount_paid) FROM fee_payments
                 WHERE DATE_TRUNC('month', academic_month) = DATE_TRUNC('month', ${currentMonth}::DATE)
               ), 0) AS total_paid
      `,
      prisma.$queryRaw<{ total_expenses: string }[]>`
        SELECT COALESCE(SUM(amount), 0) AS total_expenses
        FROM expenses
        WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', ${currentMonth}::DATE)
      `,
      // Matches the /api/fees/defaulters logic exactly (see that route).
      prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) AS total
        FROM fee_payments fp
        WHERE DATE_TRUNC('month', fp.academic_month) = DATE_TRUNC('month', ${currentMonth}::DATE)
          AND fp.amount_due > 0
          AND fp.amount_paid < fp.amount_due
      `,
      // "monthly_fees" chart: fee BILLED per month (academic_month).
      prisma.$queryRaw<{ month: string; collected: string }[]>`
        SELECT TO_CHAR(academic_month, 'Mon') AS month,
               SUM(amount_paid) AS collected
        FROM fee_payments
        WHERE EXTRACT(YEAR FROM academic_month) = ${currentYear}
        GROUP BY DATE_TRUNC('month', academic_month), TO_CHAR(academic_month, 'Mon')
        ORDER BY DATE_TRUNC('month', academic_month)
      `,
      prisma.$queryRaw<{ month: string; spent: string }[]>`
        SELECT TO_CHAR(created_at, 'Mon') AS month,
               SUM(amount) AS spent
        FROM expenses
        WHERE EXTRACT(YEAR FROM created_at) = ${currentYear}
        GROUP BY DATE_TRUNC('month', created_at), TO_CHAR(created_at, 'Mon')
        ORDER BY DATE_TRUNC('month', created_at)
      `,
    ]);

    const totalDue = parseFloat(feesMonthRes[0].total_due);
    const totalPaid = parseFloat(feesMonthRes[0].total_paid);

    return NextResponse.json({
      kpis: {
        total_students: parseInt(studentsRes[0].total.toString(), 10),
        total_staff: parseInt(staffRes[0].total.toString(), 10),
        fees_due: totalDue,
        fees_collected: totalPaid,
        fees_balance: totalDue - totalPaid,
        expenses_month: parseFloat(expensesMonthRes[0].total_expenses),
        fee_defaulters: parseInt(defaultersRes[0].total.toString(), 10),
      },
      charts: {
        monthly_fees: feesYearRes,
        monthly_expenses: expensesYearRes,
      },
    });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
