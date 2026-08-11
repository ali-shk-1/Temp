import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   GET /api/fees/receipts — optional ?from=&to=&search=
   Ported from routes/fees.js `GET /receipts`.
   Row-wise listing of every receipt ever issued — used by the Receipts
   nav page so front-desk staff can verify "is receipt #N legit?".
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = req.nextUrl;
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const search = searchParams.get('search');

    const conditions: any[] = [];
    if (from) conditions.push(Prisma.sql`AND DATE(pr.issued_at) >= ${from}::DATE`);
    if (to) conditions.push(Prisma.sql`AND DATE(pr.issued_at) <= ${to}::DATE`);
    if (search) {
      const like = `%${search.toLowerCase()}%`;
      conditions.push(Prisma.sql`AND (
        LOWER(pr.student_name) LIKE ${like} OR
        CAST(pr.roll_no AS TEXT) LIKE ${like} OR
        CAST(pr.receipt_no AS TEXT) LIKE ${like}
      )`);
    }
    const whereExtra = conditions.length ? Prisma.join(conditions, ' ', ' ') : Prisma.empty;

    const rows = await prisma.$queryRaw<any[]>`
      SELECT pr.receipt_no, pr.payment_id, pr.student_id, pr.roll_no,
             pr.student_name, pr.class, pr.section, pr.academic_month,
             pr.amount_due, pr.amount_paid, pr.print_mode, pr.issued_at, pr.issued_by
      FROM payment_receipts pr
      WHERE 1=1
      ${whereExtra}
      ORDER BY pr.receipt_no DESC
    `;

    return NextResponse.json({ count: rows.length, receipts: rows });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
