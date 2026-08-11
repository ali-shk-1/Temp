import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';

/* ─────────────────────────────────────────
   GET /api/staff — optional ?designation_id=&search=
   Ported from routes/staff.js `GET /`.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = req.nextUrl;
    const designationId = searchParams.get('designation_id');
    const search = searchParams.get('search');

    const where: Prisma.StaffWhereInput = {};
    if (designationId) where.designation_id = parseInt(designationId, 10);
    if (search) {
      const s = search.toLowerCase();
      // Original: LOWER(s.name) LIKE $1 OR s.cnic LIKE $1 (same %search% pattern
      // applied to both — cnic side was NOT lower-cased in the original, kept as-is).
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { cnic: { contains: search } },
      ];
    }

    const staff = await prisma.staff.findMany({
      where,
      include: { designation: true },
      orderBy: { name: 'asc' },
    });

    // Flatten designation.title -> designation_title to match original's
    // `d.title AS designation_title` joined column shape.
    const shaped = staff.map((s) => {
      const { designation, ...rest } = s;
      return {
        ...rest,
        salary: rest.salary == null ? null : Number(rest.salary),
        designation_title: designation?.title ?? null,
      };
    });

    return NextResponse.json({ count: shaped.length, staff: shaped });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}

/* ─────────────────────────────────────────
   POST /api/staff
   Ported from routes/staff.js `POST /`.
───────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'staff.add');
  if (denied) return denied;

  try {
    const body = await req.json();
    const { name, cnic, phone_no, salary, designation_id } = body;

    if (!name || !cnic) {
      return NextResponse.json({ error: 'name and cnic are required.' }, { status: 400 });
    }

    let staff;
    try {
      staff = await prisma.staff.create({
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
      throw err;
    }

    broadcast('staff.changed', { action: 'added', staff_id: staff.staff_id });
    return NextResponse.json(
      { message: 'Staff member added.', staff: { ...staff, salary: staff.salary == null ? null : Number(staff.salary) } },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}
