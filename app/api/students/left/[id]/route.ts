import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';
import { normalizeMonthInput, normalizeGenderInput, isValidEmail } from '@/lib/students-helpers';
import { deletePhotoByUrl } from '@/lib/uploads';
import { withDateOnlyFields } from '@/lib/date-format';

/* ─────────────────────────────────────────
   PUT /api/students/left/:id — full edit of a left-student record
───────────────────────────────────────── */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'left-students.edit');
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = await req.json();
    const {
      roll_no, section, class: cls, first_name, last_name,
      father_name, contact_1, contact_2, email, photo_url, address,
      admission_date, fee_start_month, left_date, left_reason, gender,
    } = body;

    if (!first_name) {
      return NextResponse.json({ error: 'first_name is required.' }, { status: 400 });
    }
    const rollNo = roll_no != null && roll_no !== '' ? parseInt(roll_no, 10) : null;
    if (rollNo != null && (!Number.isInteger(rollNo) || rollNo <= 0)) {
      return NextResponse.json({ error: 'Roll No must be a positive integer if provided.' }, { status: 400 });
    }
    if (email && !isValidEmail(email)) {
      return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 });
    }
    const normalizedFeeStart = normalizeMonthInput(fee_start_month);
    if (fee_start_month && !normalizedFeeStart) {
      return NextResponse.json({ error: 'fee_start_month must be in YYYY-MM format.' }, { status: 400 });
    }
    const normalizedGender = normalizeGenderInput(gender);
    if (gender && !normalizedGender) {
      return NextResponse.json({ error: 'gender must be "male" or "female" if provided.' }, { status: 400 });
    }

    // Single atomic UPDATE ... RETURNING, matching the original's one round-trip.
    // left_date uses COALESCE(new value, existing value) so "not sent" still
    // falls back to the current row's left_date without a separate read first.
    const rows = await prisma.$queryRaw<any[]>`
      UPDATE left_students
      SET
        roll_no = ${rollNo},
        section = ${section || null},
        class = ${cls || null},
        first_name = ${first_name},
        last_name = ${last_name || null},
        father_name = ${father_name || null},
        contact_1 = ${contact_1 || null},
        contact_2 = ${contact_2 || null},
        email = ${email || null},
        photo_url = ${photo_url || null},
        address = ${address || null},
        admission_date = ${admission_date ? new Date(admission_date) : null},
        fee_start_month = ${normalizedFeeStart ? new Date(normalizedFeeStart) : null},
        left_date = COALESCE(${left_date ? new Date(left_date) : null}, left_date),
        left_reason = ${left_reason || null},
        gender = ${normalizedGender || null}
      WHERE left_student_id = ${Number(id)}
      RETURNING *`;

    const former_student = rows[0];
    if (!former_student) return NextResponse.json({ error: 'Left student record not found.' }, { status: 404 });

    broadcast('left-students.changed', { action: 'updated', left_student_id: former_student.left_student_id });
    return NextResponse.json({
      message: 'Left student record updated.',
      former_student: withDateOnlyFields(former_student, ['admission_date', 'fee_start_month', 'left_date']),
    });
  } catch (err) {
    return handleApiError(err, 'PUT');
  }
}

/* ─────────────────────────────────────────
   DELETE /api/students/left/:id
───────────────────────────────────────── */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'left-students.delete');
  if (denied) return denied;

  try {
    const { id } = await params;
    // Single atomic DELETE ... RETURNING, matching the original's one round-trip.
    const rows = await prisma.$queryRaw<any[]>`
      DELETE FROM left_students
      WHERE left_student_id = ${Number(id)}
      RETURNING left_student_id, first_name, last_name, photo_url`;

    const existing = rows[0];
    if (!existing) return NextResponse.json({ error: 'Left student record not found.' }, { status: 404 });

    deletePhotoByUrl(existing.photo_url);

    broadcast('left-students.changed', { action: 'deleted', left_student_id: id });
    return NextResponse.json({
      message: 'Left student record deleted.',
      former_student: {
        left_student_id: existing.left_student_id,
        first_name: existing.first_name,
        last_name: existing.last_name,
        photo_url: existing.photo_url,
      },
    });
  } catch (err) {
    return handleApiError(err, 'DELETE');
  }
}
