import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';

/* ─────────────────────────────────────────
   PUT /api/class-fees/:id
   Body: { total_fee } (class label itself is not renameable here —
   delete and re-add if a class label needs to change).
───────────────────────────────────────── */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'class-fees.edit');
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = await req.json();
    const totalFee = Number(body.total_fee);
    if (!Number.isFinite(totalFee) || totalFee < 0) {
      return NextResponse.json({ error: 'total_fee must be a non-negative number.' }, { status: 400 });
    }

    let row;
    try {
      row = await prisma.classFee.update({
        where: { class_fee_id: parseInt(id, 10) },
        data: { total_fee: totalFee, updated_by: auth.user.username || null },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return NextResponse.json({ error: 'Class fee record not found.' }, { status: 404 });
      }
      throw err;
    }

    broadcast('class-fees.changed', { action: 'edited', id: row.class_fee_id });
    return NextResponse.json(row);
  } catch (err) {
    return handleApiError(err, 'PUT');
  }
}

/* ─────────────────────────────────────────
   DELETE /api/class-fees/:id
───────────────────────────────────────── */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'class-fees.delete');
  if (denied) return denied;

  try {
    const { id } = await params;
    let row;
    try {
      row = await prisma.classFee.delete({
        where: { class_fee_id: parseInt(id, 10) },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return NextResponse.json({ error: 'Class fee record not found.' }, { status: 404 });
      }
      throw err;
    }

    broadcast('class-fees.changed', { action: 'deleted', id: row.class_fee_id });
    return NextResponse.json({ message: 'Class fee record deleted.' });
  } catch (err) {
    return handleApiError(err, 'DELETE');
  }
}
