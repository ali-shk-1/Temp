import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';
import { allowedClasses, normalizeMonthInput, normalizeGenderInput, isValidEmail, normalizePhoneInput, normalizeSectionInput } from '@/lib/students-helpers';
import { deletePhotoByUrl } from '@/lib/uploads';
import { withDateOnlyFields } from '@/lib/date-format';

/* ─────────────────────────────────────────
   GET /api/students/:id
───────────────────────────────────────── */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const { id } = await params;
    const student = await prisma.student.findUnique({ where: { student_id: Number(id) } });
    if (!student) return NextResponse.json({ error: 'Student not found.' }, { status: 404 });
    return NextResponse.json(withDateOnlyFields(student, ['admission_date', 'fee_start_month']));
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}

/* ─────────────────────────────────────────
   PUT /api/students/:id
───────────────────────────────────────── */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'students.edit');
  if (denied) return denied;

  try {
    const { id } = await params;
    const studentId = Number(id);
    const body = await req.json();
    const {
      roll_no, section, class: cls, first_name, last_name,
      father_name, contact_1, contact_2, email, photo_url, address,
      admission_date, fee_start_month, gender,
    } = body;

    if (!section || !cls || !first_name) {
      return NextResponse.json({ error: 'section, class, and first_name are required.' }, { status: 400 });
    }
    const normalizedClass = String(cls).trim().toLowerCase();
    if (!allowedClasses.has(normalizedClass)) {
      return NextResponse.json({ error: 'Class must be one of playgroup, nursery, prep, or 1 through 10.' }, { status: 400 });
    }
    const normalizedSection = normalizeSectionInput(section);
    if (!normalizedSection) {
      return NextResponse.json(
        { error: 'Section must be a single letter (A, B, C) or a stream + letter like Csc-A, Bio-B, Arts-A.' },
        { status: 400 },
      );
    }
    const explicitRollNo = roll_no != null && roll_no !== '' ? parseInt(roll_no, 10) : null;
    if (explicitRollNo != null && (!Number.isInteger(explicitRollNo) || explicitRollNo <= 0)) {
      return NextResponse.json({ error: 'Roll No must be a positive integer if provided.' }, { status: 400 });
    }
    if (email && !isValidEmail(email)) {
      return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 });
    }
    if (photo_url && !/^(?:https?:\/\/|\/uploads\/)/i.test(photo_url)) {
      return NextResponse.json({ error: 'Photo URL must begin with http://, https://, or /uploads/.' }, { status: 400 });
    }
    const normalizedFeeStart = normalizeMonthInput(fee_start_month);
    if (fee_start_month && !normalizedFeeStart) {
      return NextResponse.json({ error: 'fee_start_month must be in YYYY-MM format.' }, { status: 400 });
    }
    const normalizedGender = normalizeGenderInput(gender);
    if (!normalizedGender) {
      return NextResponse.json({ error: 'Gender is required and must be "male" or "female".' }, { status: 400 });
    }

    const current = await prisma.student.findUnique({
      where: { student_id: studentId },
      select: { class: true, section: true, gender: true, roll_no: true },
    });
    if (!current) return NextResponse.json({ error: 'Student not found.' }, { status: 404 });

    const scopeChanged =
      normalizedClass !== current.class ||
      normalizedSection !== current.section ||
      (normalizedGender || null) !== (current.gender || null);

    const MAX_ATTEMPTS = 5;
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let rollNo = explicitRollNo;
      if (rollNo == null && scopeChanged) {
        const maxRow = await prisma.student.aggregate({
          _max: { roll_no: true },
          where: { class: normalizedClass, section: normalizedSection, gender: normalizedGender ?? null },
        });
        const maxRoll = maxRow._max.roll_no;
        rollNo = maxRoll != null ? maxRoll + 1 : 1;
      }

      try {
        const student = await prisma.student.update({
          where: { student_id: studentId },
          data: {
            roll_no: rollNo ?? undefined,
            section: normalizedSection,
            class: normalizedClass,
            first_name,
            last_name: last_name || null,
            father_name: father_name || null,
            contact_1: contact_1 ? normalizePhoneInput(contact_1) : null,
            contact_2: contact_2 ? normalizePhoneInput(contact_2) : null,
            email: email || null,
            photo_url: photo_url || null,
            address: address || null,
            admission_date: admission_date ? new Date(admission_date) : undefined,
            fee_start_month: normalizedFeeStart ? new Date(normalizedFeeStart) : undefined,
            gender: normalizedGender || null,
          },
        });

        broadcast('students.changed', { action: 'updated', student_id: student.student_id });
        return NextResponse.json({
          message: 'Student updated.',
          student: withDateOnlyFields(student, ['admission_date', 'fee_start_month']),
        });
      } catch (err) {
        const isRollNoCollision =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          (((err.meta?.target as string[] | undefined) ?? []).some((t) => /roll_no/i.test(t)));
        if (isRollNoCollision && explicitRollNo == null && scopeChanged && attempt < MAX_ATTEMPTS - 1) {
          lastErr = err;
          continue;
        }
        if (isRollNoCollision) {
          return NextResponse.json(
            { error: 'That Roll No is already in use for this class, section, and gender.' },
            { status: 409 }
          );
        }
        throw err;
      }
    }
    throw lastErr;
  } catch (err) {
    return handleApiError(err, 'PUT');
  }
}

/* ─────────────────────────────────────────
   DELETE /api/students/:id — gated by can('students.delete').
   Permanent purge: deletes fee_payments first (transaction), then the
   student row, then the photo file. Distinct from POST /:id/leave, which
   preserves fee history.
───────────────────────────────────────── */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'students.delete');
  if (denied) return denied;

  try {
    const { id } = await params;
    const studentId = Number(id);

    const result = await prisma.$transaction(async (tx) => {
      const student = await tx.student.findUnique({ where: { student_id: studentId } });
      if (!student) return null;
      await tx.feePayment.deleteMany({ where: { student_id: studentId } });
      await tx.student.delete({ where: { student_id: studentId } });
      return student;
    });

    if (!result) return NextResponse.json({ error: 'Student not found.' }, { status: 404 });

    deletePhotoByUrl(result.photo_url);

    broadcast('students.changed', { action: 'deleted', student_id: result.student_id });
    return NextResponse.json({
      message: 'Student deleted.',
      student: { student_id: result.student_id, first_name: result.first_name, last_name: result.last_name, photo_url: result.photo_url },
    });
  } catch (err) {
    return handleApiError(err, 'DELETE');
  }
}