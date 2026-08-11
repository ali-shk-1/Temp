import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';

/* ─────────────────────────────────────────
   GET /api/staff/:id
   Ported from routes/staff.js `GET /:id`.
───────────────────────────────────────── */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const { id } = await params;
    const staff = await prisma.staff.findUnique({
      where: { staff_id: parseInt(id, 10) },
      include: { designation: true },
    });
    if (!staff) return NextResponse.json({ error: 'Staff member not found.' }, { status: 404 });

    const { designation, ...rest } = staff;
    return NextResponse.json({
      ...rest,
      salary: rest.salary == null ? null : Number(rest.salary),
      designation_title: designation?.title ?? null,
    });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}

/* ─────────────────────────────────────────
   PUT /api/staff/:id
   Ported from routes/staff.js `PUT /:id`.
───────────────────────────────────────── */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'staff.edit');
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = await req.json();
    const { name, cnic, phone_no, salary, designation_id } = body;

    if (!name || !cnic) {
      return NextResponse.json({ error: 'name and cnic are required.' }, { status: 400 });
    }

    let staff;
    try {
      staff = await prisma.staff.update({
        where: { staff_id: parseInt(id, 10) },
        data: {
          name,
          cnic,
          phone_no: phone_no || null,
          salary: salary != null && salary !== '' ? salary : null,
          designation_id: designation_id || null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json({ error: 'A staff member with this CNIC already exists.' }, { status: 409 });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return NextResponse.json({ error: 'Staff member not found.' }, { status: 404 });
      }
      throw err;
    }

    broadcast('staff.changed', { action: 'updated', staff_id: staff.staff_id });
    return NextResponse.json({
      message: 'Staff member updated.',
      staff: { ...staff, salary: staff.salary == null ? null : Number(staff.salary) },
    });
  } catch (err) {
    return handleApiError(err, 'PUT');
  }
}

/* ─────────────────────────────────────────
   DELETE /api/staff/:id
   Ported from routes/staff.js `DELETE /:id`.
───────────────────────────────────────── */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'staff.delete');
  if (denied) return denied;

  try {
    const { id } = await params;
    let staff;
    try {
      staff = await prisma.staff.delete({
        where: { staff_id: parseInt(id, 10) },
        select: { staff_id: true, name: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return NextResponse.json({ error: 'Staff member not found.' }, { status: 404 });
      }
      throw err;
    }

    broadcast('staff.changed', { action: 'deleted', staff_id: staff.staff_id });
    return NextResponse.json({ message: 'Staff member deleted.', staff });
  } catch (err) {
    return handleApiError(err, 'DELETE');
  }
}
