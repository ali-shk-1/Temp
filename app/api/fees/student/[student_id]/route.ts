import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   GET /api/fees/student/:student_id
   Ported from routes/fees.js `GET /student/:student_id`.
───────────────────────────────────────── */
export async function GET(req: NextRequest, { params }: { params: Promise<{ student_id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const { student_id } = await params;
    const rows = await prisma.$queryRaw<any[]>`
      SELECT fp.*,
             (fp.amount_due - fp.amount_paid) AS balance,
             s.first_name, s.last_name, s.roll_no, s.class, s.section,
             pr.receipt_no
      FROM fee_payments fp
      JOIN students s ON s.student_id = fp.student_id
      LEFT JOIN payment_receipts pr ON pr.payment_id = fp.payment_id
      WHERE fp.student_id = ${parseInt(student_id, 10)}
      ORDER BY fp.academic_month DESC
    `;
    return NextResponse.json({ count: rows.length, payments: rows });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
