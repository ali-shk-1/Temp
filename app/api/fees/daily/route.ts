import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   GET /api/fees/daily?date=YYYY-MM-DD
   Ported from routes/fees.js `GET /daily`.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10);

    const rows = await prisma.$queryRaw<any[]>`
      SELECT fp.payment_id, fp.student_id, fp.academic_month, fp.amount_due, fp.amount_paid,
             fp.payment_date, s.first_name, s.last_name, s.class, s.section, s.gender, s.photo_url,
             pr.receipt_no
      FROM fee_payments fp
      JOIN students s ON s.student_id = fp.student_id
      LEFT JOIN payment_receipts pr ON pr.payment_id = fp.payment_id
      WHERE DATE(fp.payment_date) = ${date}::DATE
      ORDER BY fp.payment_date DESC
    `;

    return NextResponse.json({ count: rows.length, payments: rows });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
