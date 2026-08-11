import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   GET /api/students/meta/classes
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const rows = await prisma.student.findMany({
      select: { class: true, section: true },
      distinct: ['class', 'section'],
      orderBy: [{ class: 'asc' }, { section: 'asc' }],
    });
    return NextResponse.json(rows);
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
