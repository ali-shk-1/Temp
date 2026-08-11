import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';
import { withDateOnlyFields } from '@/lib/date-format';

/* ─────────────────────────────────────────
   PUT /api/fees/:payment_id
   Ported from routes/fees.js `PUT /:payment_id`.
   Editing an existing record (e.g. fixing a typo) does NOT touch
   payment_date — only the columns actually sent are updated.
───────────────────────────────────────── */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ payment_id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'fees.edit');
  if (denied) return denied;

  try {
    const { payment_id } = await params;
    const body = await req.json();
    const { amount_paid, amount_due } = body;

    if (amount_paid == null && amount_due == null) {
      return NextResponse.json({ error: 'amount_paid or amount_due is required.' }, { status: 400 });
    }

    const data: Prisma.FeePaymentUpdateInput = {};
    if (amount_due != null) data.amount_due = amount_due;
    if (amount_paid != null) data.amount_paid = amount_paid;

    let payment;
    try {
      payment = await prisma.feePayment.update({
        where: { payment_id: parseInt(payment_id, 10) },
        data,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return NextResponse.json({ error: 'Payment record not found.' }, { status: 404 });
      }
      throw err;
    }

    broadcast('fees.changed', { action: 'updated', payment_id: payment.payment_id });
    return NextResponse.json({
      message: 'Payment updated.',
      payment: withDateOnlyFields(
        {
          ...payment,
          amount_due: payment.amount_due == null ? null : Number(payment.amount_due),
          amount_paid: payment.amount_paid == null ? null : Number(payment.amount_paid),
        },
        ['academic_month']
      ),
    });
  } catch (err) {
    return handleApiError(err, 'PUT');
  }
}

/* ─────────────────────────────────────────
   DELETE /api/fees/:payment_id
   Ported from routes/fees.js `DELETE /:payment_id`.
───────────────────────────────────────── */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ payment_id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'fees.delete');
  if (denied) return denied;

  try {
    const { payment_id } = await params;
    let payment;
    try {
      payment = await prisma.feePayment.delete({
        where: { payment_id: parseInt(payment_id, 10) },
        select: { payment_id: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return NextResponse.json({ error: 'Payment record not found.' }, { status: 404 });
      }
      throw err;
    }

    broadcast('fees.changed', { action: 'deleted', payment_id: payment.payment_id });
    return NextResponse.json({ message: 'Payment deleted.' });
  } catch (err) {
    return handleApiError(err, 'DELETE');
  }
}
