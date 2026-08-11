import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { normalizeMonthInput } from '@/lib/fees-helpers';

/* ─────────────────────────────────────────
   GET /api/fees/monthly-defaulters?month=YYYY-MM
   Ported from routes/fees.js `GET /monthly-defaulters`.

   One row PER STUDENT PER UNPAID MONTH (not collapsed/cumulative),
   built from generate_series of each student's billable months from
   fee_start_month (or admission_date) through the target month.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const month = normalizeMonthInput(req.nextUrl.searchParams.get('month')) || `${new Date().toISOString().slice(0, 7)}-01`;

    const rows = await prisma.$queryRaw<any[]>`
      WITH student_months AS (
        SELECT s.student_id,
               s.roll_no,
               s.first_name,
               s.last_name,
               s.class,
               s.section,
               s.gender,
               s.father_name,
               s.contact_1,
               s.contact_2,
               s.address,
               s.admission_date,
               COALESCE(s.fee_start_month, DATE_TRUNC('month', s.admission_date)) AS fee_start_month,
               generate_series(
                 COALESCE(s.fee_start_month, DATE_TRUNC('month', s.admission_date)),
                 DATE_TRUNC('month', ${month}::DATE),
                 INTERVAL '1 month'
               )::date AS academic_month
        FROM students s
        WHERE COALESCE(s.fee_start_month, DATE_TRUNC('month', s.admission_date)) <= DATE_TRUNC('month', ${month}::DATE)
      ),
      payment_agg AS (
        SELECT fp.student_id,
               DATE_TRUNC('month', fp.academic_month)::date AS academic_month,
               SUM(fp.amount_due)  AS amount_due,
               SUM(fp.amount_paid) AS amount_paid
        FROM fee_payments fp
        WHERE DATE_TRUNC('month', fp.academic_month) <= DATE_TRUNC('month', ${month}::DATE)
        GROUP BY fp.student_id, DATE_TRUNC('month', fp.academic_month)
      )
      SELECT sm.student_id,
             sm.roll_no,
             sm.first_name,
             sm.last_name,
             sm.class,
             sm.section,
             sm.gender,
             sm.father_name,
             sm.contact_1,
             sm.contact_2,
             sm.address,
             sm.academic_month,
             COALESCE(pa.amount_due, 0)  AS amount_due,
             COALESCE(pa.amount_paid, 0) AS amount_paid,
             (COALESCE(pa.amount_due, 0) - COALESCE(pa.amount_paid, 0)) AS balance
      FROM student_months sm
      LEFT JOIN payment_agg pa
        ON pa.student_id = sm.student_id
        AND pa.academic_month = sm.academic_month
      WHERE pa.amount_due IS NULL
         OR COALESCE(pa.amount_paid, 0) < COALESCE(pa.amount_due, 0)
      ORDER BY sm.academic_month DESC, sm.class, sm.section, sm.roll_no
    `;

    // Group the flat per-month rows into { academic_month, defaulters: [...] }
    // buckets — see original comment. The flat `defaulters` array (all rows
    // across all months) is also returned so total_overdue_months/count keep
    // meaning "total defaulter-month instances", unchanged.
    const monthGroups: Record<string, any[]> = {};
    for (const row of rows) {
      const key = String(row.academic_month).slice(0, 10);
      if (!monthGroups[key]) monthGroups[key] = [];
      monthGroups[key].push(row);
    }
    const months = Object.keys(monthGroups)
      .sort((a, b) => b.localeCompare(a))
      .map((key) => ({
        academic_month: key,
        count: monthGroups[key].length,
        defaulters: monthGroups[key],
      }));

    return NextResponse.json({
      count: rows.length,
      month,
      total_overdue_months: rows.length,
      defaulters: rows,
      months,
    });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
