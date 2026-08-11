import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';
import { withDateOnlyFields } from '@/lib/date-format';

/* ─────────────────────────────────────────
   POST /api/staff/:id/leave
   Ported from routes/staff.js `POST /:id/leave`.

   Unlike students, leaving staff does NOT delete any related records —
   just moves the row to left_staff and removes them from the active
   staff table. designation/designation_title are snapshotted onto the
   left_staff row itself so history is preserved even if the designation
   is later renamed or deleted.
───────────────────────────────────────── */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'staff.leave');
  if (denied) return denied;

  try {
    const { id } = await params;
    const staffId = parseInt(id, 10);
    const body = await req.json().catch(() => ({}));
    const { left_reason } = body;

    const staff = await prisma.staff.findUnique({
      where: { staff_id: staffId },
      include: { designation: true },
    });
    if (!staff) return NextResponse.json({ error: 'Staff member not found.' }, { status: 404 });

    const [leftStaff] = await prisma.$transaction([
      prisma.leftStaff.create({
        data: {
          old_staff_id: staff.staff_id,
          name: staff.name,
          cnic: staff.cnic,
          phone_no: staff.phone_no,
          salary: staff.salary,
          designation_id: staff.designation_id,
          designation: staff.designation?.title ?? null,
          left_date: new Date(),
          left_reason: left_reason || null,
        },
      }),
      prisma.staff.delete({ where: { staff_id: staffId } }),
    ]);

    broadcast('staff.changed', { action: 'left', staff_id: staffId });
    broadcast('left-staff.changed', { action: 'added', left_staff_id: leftStaff.left_staff_id });

    return NextResponse.json({
      message: 'Staff member moved to left_staff.',
      left_staff: withDateOnlyFields(
        { ...leftStaff, salary: leftStaff.salary == null ? null : Number(leftStaff.salary) },
        ['left_date']
      ),
    });
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}
