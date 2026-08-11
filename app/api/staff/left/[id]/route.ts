import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';
import { withDateOnlyFields } from '@/lib/date-format';

/* ─────────────────────────────────────────
   PUT /api/staff/left/:id
   Ported from routes/staff.js `PUT /left/:id`.
───────────────────────────────────────── */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'left-staff.edit');
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = await req.json();
    const { name, cnic, phone_no, salary, designation_id, designation, left_date, left_reason } = body;

    if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 });

    let leftStaff;
    try {
      leftStaff = await prisma.leftStaff.update({
        where: { left_staff_id: parseInt(id, 10) },
        data: {
          name,
          cnic: cnic || null,
          phone_no: phone_no || null,
          salary: salary != null && salary !== '' ? salary : null,
          designation_id: designation_id || null,
          designation: designation || null,
          // COALESCE($7, left_date) in original — only overwrite if provided.
          ...(left_date ? { left_date: new Date(left_date) } : {}),
          left_reason: left_reason || null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return NextResponse.json({ error: 'Left staff record not found.' }, { status: 404 });
      }
      throw err;
    }

    broadcast('left-staff.changed', { action: 'updated', left_staff_id: leftStaff.left_staff_id });
    return NextResponse.json({
      message: 'Left staff record updated.',
      left_staff: withDateOnlyFields(
        { ...leftStaff, salary: leftStaff.salary == null ? null : Number(leftStaff.salary) },
        ['left_date']
      ),
    });
  } catch (err) {
    return handleApiError(err, 'PUT');
  }
}

/* ─────────────────────────────────────────
   DELETE /api/staff/left/:id
   Ported from routes/staff.js `DELETE /left/:id`.
───────────────────────────────────────── */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'left-staff.delete');
  if (denied) return denied;

  try {
    const { id } = await params;
    let leftStaff;
    try {
      leftStaff = await prisma.leftStaff.delete({
        where: { left_staff_id: parseInt(id, 10) },
        select: { left_staff_id: true, name: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return NextResponse.json({ error: 'Left staff record not found.' }, { status: 404 });
      }
      throw err;
    }

    broadcast('left-staff.changed', { action: 'deleted', left_staff_id: leftStaff.left_staff_id });
    return NextResponse.json({ message: 'Left staff record deleted.', left_staff: leftStaff });
  } catch (err) {
    return handleApiError(err, 'DELETE');
  }
}
