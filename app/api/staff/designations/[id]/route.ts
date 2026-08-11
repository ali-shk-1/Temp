import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';

/* ─────────────────────────────────────────
   DELETE /api/staff/designations/:id
   Ported from routes/staff.js `DELETE /designations/:id`.
───────────────────────────────────────── */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'staff.designations');
  if (denied) return denied;

  try {
    const { id } = await params;
    try {
      await prisma.designation.delete({ where: { id: parseInt(id, 10) } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return NextResponse.json({ error: 'Designation not found.' }, { status: 404 });
      }
      throw err;
    }

    broadcast('designations.changed', { action: 'deleted', id });
    return NextResponse.json({ message: 'Designation deleted.' });
  } catch (err) {
    return handleApiError(err, 'DELETE');
  }
}
