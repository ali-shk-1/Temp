import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';

/* ─────────────────────────────────────────
   GET /api/staff/designations
   Ported from routes/staff.js `GET /designations`.
   Note: original returns the bare array (not {count, ...}) — preserved.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const designations = await prisma.designation.findMany({
      orderBy: { title: 'asc' },
    });
    return NextResponse.json(designations);
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}

/* ─────────────────────────────────────────
   POST /api/staff/designations
   Ported from routes/staff.js `POST /designations`.
───────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'staff.designations');
  if (denied) return denied;

  try {
    const body = await req.json();
    const { title } = body;
    if (!title) return NextResponse.json({ error: 'title is required.' }, { status: 400 });

    const designation = await prisma.designation.create({ data: { title } });

    broadcast('designations.changed', { action: 'added', id: designation.id });
    return NextResponse.json(designation, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}
