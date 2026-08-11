import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { withDateOnlyFields } from '@/lib/date-format';

/* ─────────────────────────────────────────
   GET /api/staff/left
   Ported from routes/staff.js `GET /left`.
   NOTE: this route must be registered before /api/staff/[id] would
   otherwise swallow it — in Next.js App Router this is automatic since
   /left is a static segment and takes priority over [id], no ordering
   trick needed (unlike the original Express router).
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const formerStaff = await prisma.leftStaff.findMany({
      orderBy: [{ left_date: 'desc' }, { name: 'asc' }],
    });
    const shaped = formerStaff.map((s) =>
      withDateOnlyFields(
        { ...s, salary: s.salary == null ? null : Number(s.salary) },
        ['left_date']
      )
    );
    return NextResponse.json({ count: shaped.length, former_staff: shaped });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
