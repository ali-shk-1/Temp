import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';
import { withDateOnlyFields } from '@/lib/date-format';

/* ─────────────────────────────────────────
   GET /api/staff — optional ?designation_id=&search=&admin_id=&under_admin=
   Ported from routes/staff.js `GET /`.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = req.nextUrl;
    const designationId = searchParams.get('designation_id');
    const search = searchParams.get('search');
    const adminId = searchParams.get('admin_id');
    const underAdmin = searchParams.get('under_admin');

    const where: Prisma.StaffWhereInput = {};
    if (designationId) where.designation_id = parseInt(designationId, 10);
    if (adminId) where.admin_id = parseInt(adminId, 10);
    // under_admin=1 filters to staff who report to ANY admin (admin_id set);
    // under_admin=0 filters to staff who don't report to anyone.
    if (underAdmin === '1') where.admin_id = { not: null };
    else if (underAdmin === '0') where.admin_id = null;
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
      include: { designation: true, admin: true },
      orderBy: { name: 'asc' },
    });

    // Flatten designation.title -> designation_title to match original's
    // `d.title AS designation_title` joined column shape. Also flatten
    // admin.name -> admin_name for display, without exposing the full
    // nested admin staff record.
    const shaped = staff.map((s) => {
      const { designation, admin, ...rest } = s;
      return withDateOnlyFields(
        {
          ...rest,
          salary: rest.salary == null ? null : Number(rest.salary),
          designation_title: designation?.title ?? null,
          admin_name: admin?.name ?? null,
        },
        ['joining_date'],
      );
    });

    return NextResponse.json({ count: shaped.length, staff: shaped });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}

/* ─────────────────────────────────────────
   POST /api/staff
   Ported from routes/staff.js `POST /`, extended with photo_url,
   joining_date, category, and admin_id (all optional/additive).
───────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'staff.add');
  if (denied) return denied;

  try {
    const body = await req.json();
    const { name, cnic, phone_no, salary, designation_id, photo_url, joining_date, category, admin_id } = body;

    if (!name || !cnic) {
      return NextResponse.json({ error: 'name and cnic are required.' }, { status: 400 });
    }
    if (category && category !== 'category_1' && category !== 'category_2') {
      return NextResponse.json({ error: 'category must be "category_1" or "category_2".' }, { status: 400 });
    }
    if (photo_url && !/^(?:https?:\/\/|\/uploads\/)/i.test(photo_url)) {
      return NextResponse.json({ error: 'Photo URL must begin with http://, https://, or /uploads/.' }, { status: 400 });
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
          photo_url: photo_url || null,
          joining_date: joining_date ? new Date(joining_date) : new Date(),
          category: category || null,
          admin_id: admin_id || null,
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
      {
        message: 'Staff member added.',
        staff: withDateOnlyFields({ ...staff, salary: staff.salary == null ? null : Number(staff.salary) }, ['joining_date']),
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}
