import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';
import { withDateOnlyFields } from '@/lib/date-format';

/* ─────────────────────────────────────────
   GET /api/expenses/:id
   Ported from routes/expenses.js `GET /:id`.
───────────────────────────────────────── */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const { id } = await params;
    const expense = await prisma.expense.findUnique({
      where: { expense_id: parseInt(id, 10) },
      include: { category: true },
    });
    if (!expense) return NextResponse.json({ error: 'Expense not found.' }, { status: 404 });

    const { category, ...rest } = expense;
    return NextResponse.json(
      withDateOnlyFields(
        {
          ...rest,
          amount: rest.amount == null ? null : Number(rest.amount),
          category_name: category?.category_name ?? null,
        },
        ['created_at']
      )
    );
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}

/* ─────────────────────────────────────────
   PUT /api/expenses/:id
   Ported from routes/expenses.js `PUT /:id`.
───────────────────────────────────────── */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'expenses.edit');
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = await req.json();
    const { category_id, amount, description, created_at } = body;

    if (!amount) return NextResponse.json({ error: 'amount is required.' }, { status: 400 });

    let expense;
    try {
      expense = await prisma.expense.update({
        where: { expense_id: parseInt(id, 10) },
        data: {
          category_id: category_id || null,
          amount,
          description: description || null,
          created_at: created_at ? new Date(created_at) : new Date(),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return NextResponse.json({ error: 'Expense not found.' }, { status: 404 });
      }
      throw err;
    }

    broadcast('expenses.changed', { action: 'updated', expense_id: expense.expense_id });
    return NextResponse.json({
      message: 'Expense updated.',
      expense: withDateOnlyFields(
        { ...expense, amount: expense.amount == null ? null : Number(expense.amount) },
        ['created_at']
      ),
    });
  } catch (err) {
    return handleApiError(err, 'PUT');
  }
}

/* ─────────────────────────────────────────
   DELETE /api/expenses/:id
   Ported from routes/expenses.js `DELETE /:id`.
   Gated by can('expenses.delete'), which defaults to admin-only but is
   toggleable per-role by ali from the Permissions page.
───────────────────────────────────────── */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'expenses.delete');
  if (denied) return denied;

  try {
    const { id } = await params;
    let expense;
    try {
      expense = await prisma.expense.delete({
        where: { expense_id: parseInt(id, 10) },
        select: { expense_id: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return NextResponse.json({ error: 'Expense not found.' }, { status: 404 });
      }
      throw err;
    }

    broadcast('expenses.changed', { action: 'deleted', expense_id: expense.expense_id });
    return NextResponse.json({ message: 'Expense deleted.' });
  } catch (err) {
    return handleApiError(err, 'DELETE');
  }
}
