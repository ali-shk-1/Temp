import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { withDateOnlyFields } from '@/lib/date-format';

/* ─────────────────────────────────────────
   GET /api/students/left
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const former_students = await prisma.leftStudent.findMany({
      orderBy: [{ left_date: 'desc' }, { roll_no: 'asc' }],
    });
    const shaped = former_students.map((s) =>
      withDateOnlyFields(s, ['admission_date', 'fee_start_month', 'left_date'])
    );
    return NextResponse.json({ count: shaped.length, former_students: shaped });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
