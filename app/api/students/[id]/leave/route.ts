import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';

/* ─────────────────────────────────────────
   POST /api/students/:id/leave
   Ported from routes/students.js — transactional: snapshot the student
   into left_students, snapshot fee_payments into
   left_student_fee_payments, then delete both from the active tables.
───────────────────────────────────────── */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'students.leave');
  if (denied) return denied;

  try {
    const { id } = await params;
    const studentId = Number(id);
    const body = await req.json().catch(() => ({}));
    const { left_reason } = body;

    const result = await prisma.$transaction(async (tx) => {
      const student = await tx.student.findUnique({ where: { student_id: studentId } });
      if (!student) return null;

      const leftStudent = await tx.leftStudent.create({
        data: {
          roll_no: student.roll_no,
          section: student.section,
          class: student.class,
          first_name: student.first_name,
          last_name: student.last_name,
          father_name: student.father_name,
          contact_1: student.contact_1,
          contact_2: student.contact_2,
          email: student.email,
          photo_url: student.photo_url,
          address: student.address,
          admission_date: student.admission_date,
          fee_start_month: student.fee_start_month || student.admission_date,
          left_date: new Date(),
          left_reason: left_reason || null,
          gender: student.gender,
        },
      });

      const feePayments = await tx.feePayment.findMany({ where: { student_id: studentId } });
      if (feePayments.length > 0) {
        await tx.leftStudentFeePayment.createMany({
          data: feePayments.map((fp) => ({
            left_student_id: leftStudent.left_student_id,
            old_student_id: fp.student_id,
            academic_month: fp.academic_month,
            amount_due: fp.amount_due,
            amount_paid: fp.amount_paid,
            payment_date: fp.payment_date,
          })),
        });
      }

      await tx.feePayment.deleteMany({ where: { student_id: studentId } });
      await tx.student.delete({ where: { student_id: studentId } });

      return leftStudent;
    });

    if (!result) {
      return NextResponse.json({ error: 'Student not found.' }, { status: 404 });
    }

    broadcast('students.changed', { action: 'left', student_id: studentId });
    broadcast('left-students.changed', { action: 'added', student_id: studentId });
    return NextResponse.json({ message: 'Student moved to left_students.', student_id: studentId });
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}
