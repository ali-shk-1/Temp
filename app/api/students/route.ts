import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';
import { withDateOnlyFields } from '@/lib/date-format';
import {
  allowedClasses,
  normalizeMonthInput,
  normalizeGenderInput,
  getClassRollStart,
  isValidEmail,
  normalizePhoneInput,
  normalizeSectionInput,
} from '@/lib/students-helpers';

/* ─────────────────────────────────────────
   GET /api/students
   Query params: class, section, search (name/roll_no), gender
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = req.nextUrl;
    const cls = searchParams.get('class');
    const section = searchParams.get('section');
    const search = searchParams.get('search');
    const gender = searchParams.get('gender');

    const where: Prisma.StudentWhereInput = {};
    if (cls) where.class = cls;
    if (section) where.section = section;
    if (gender) where.gender = gender;
    if (search) {
      const s = search.toLowerCase();
      where.OR = [
        { first_name: { contains: s, mode: 'insensitive' } },
        { last_name: { contains: s, mode: 'insensitive' } },
        // roll_no is an Int column; original used CAST(roll_no AS TEXT) LIKE
        // for a partial numeric match. Prisma can't do a partial-text match
        // on an Int column directly, so we filter in JS below for that part.
      ];
    }

    const students = await prisma.student.findMany({
      where,
      orderBy: [{ class: 'asc' }, { section: 'asc' }, { roll_no: 'asc' }],
    });

    // Partial roll_no text match, matching the original's
    // CAST(roll_no AS TEXT) LIKE '%search%' behavior, OR'd with name match.
    const filtered = search
      ? students.filter((s) => {
          const q = search.toLowerCase();
          return (
            (s.first_name || '').toLowerCase().includes(q) ||
            (s.last_name || '').toLowerCase().includes(q) ||
            String(s.roll_no).includes(q)
          );
        })
      : students;

    return NextResponse.json({
      count: filtered.length,
      students: filtered.map((s) => withDateOnlyFields(s, ['admission_date', 'fee_start_month'])),
    });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}

/* ─────────────────────────────────────────
   POST /api/students
───────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'students.add');
  if (denied) return denied;

  try {
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
    let explicitRollNo = roll_no != null && roll_no !== '' ? parseInt(roll_no, 10) : null;
    if (explicitRollNo != null && (!Number.isInteger(explicitRollNo) || explicitRollNo <= 0)) {
      return NextResponse.json({ error: 'Roll No must be a positive integer if provided.' }, { status: 400 });
    }
    if (email && !isValidEmail(email)) {
      return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 });
    }
    if (photo_url && !/^(?:https?:\/\/|\/uploads\/)/i.test(photo_url)) {
      return NextResponse.json({ error: 'Photo URL must begin with http://, https://, or /uploads or /uploads/.' }, { status: 400 });
    }
    const normalizedFeeStart = normalizeMonthInput(fee_start_month);
    if (fee_start_month && !normalizedFeeStart) {
      return NextResponse.json({ error: 'fee_start_month must be in YYYY-MM format.' }, { status: 400 });
    }
    const normalizedGender = normalizeGenderInput(gender);
    if (!normalizedGender) {
      return NextResponse.json({ error: 'Gender is required and must be "male" or "female".' }, { status: 400 });
    }

    // Roll numbers assigned per class+section+gender. Retry on collision
    // (unique index enforces it at the DB level) — mirrors original.
    const MAX_ATTEMPTS = 5;
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let rollNo = explicitRollNo;
      if (rollNo == null) {
        const classStart = getClassRollStart(normalizedClass);
        const maxRow = await prisma.student.aggregate({
          _max: { roll_no: true },
          where: {
            class: normalizedClass,
            section: normalizedSection,
            gender: normalizedGender ?? null,
          },
        });
        const maxRoll = maxRow._max.roll_no;
        rollNo = maxRoll != null && maxRoll >= classStart ? maxRoll + 1 : classStart;
      }

      try {
        const student = await prisma.student.create({
          data: {
            roll_no: rollNo,
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
            admission_date: admission_date ? new Date(admission_date) : new Date(),
            fee_start_month: normalizedFeeStart ? new Date(normalizedFeeStart) : null,
            gender: normalizedGender || null,
          },
        });

        broadcast('students.changed', { action: 'added', student_id: student.student_id });
        return NextResponse.json(
          { message: 'Student added.', student: withDateOnlyFields(student, ['admission_date', 'fee_start_month']) },
          { status: 201 }
        );
      } catch (err) {
        const isRollNoCollision =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          (((err.meta?.target as string[] | undefined) ?? []).some((t) => /roll_no/i.test(t)));
        if (isRollNoCollision && explicitRollNo == null && attempt < MAX_ATTEMPTS - 1) {
          lastErr = err;
          continue;
        }
        if (isRollNoCollision && explicitRollNo != null) {
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
    return handleApiError(err, 'POST');
  }
}