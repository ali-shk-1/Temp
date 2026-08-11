import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';
import { withDateOnlyFields } from '@/lib/date-format';

/* ─────────────────────────────────────────
   GET /api/expenses — optional ?category_id=&from=&to=&month=
   Ported from routes/expenses.js `GET /`.
   month (YYYY-MM) takes precedence over from/to when both are supplied,
   matching the original's if/else branching exactly.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = req.nextUrl;
    const categoryId = searchParams.get('category_id');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const month = searchParams.get('month');

    const conditions: Prisma.Sql[] = [];
    if (categoryId) conditions.push(Prisma.sql`AND e.category_id = ${parseInt(categoryId, 10)}`);
    if (month) {
      conditions.push(Prisma.sql`AND DATE_TRUNC('month', e.created_at) = DATE_TRUNC('month', ${`${month}-01`}::DATE)`);
    } else {
      if (from) conditions.push(Prisma.sql`AND e.created_at >= ${from}::DATE`);
      if (to) conditions.push(Prisma.sql`AND e.created_at < (${to}::DATE + INTERVAL '1 day')`);
    }
    const whereExtra = conditions.length ? Prisma.join(conditions, ' ', ' ') : Prisma.empty;

    const rows = await prisma.$queryRaw<any[]>`
      SELECT e.*, ec.category_name
      FROM expenses e
      LEFT JOIN expense_categories ec ON ec.category_id = e.category_id
      WHERE 1=1
      ${whereExtra}
      ORDER BY e.created_at DESC
    `;

    return NextResponse.json({ count: rows.length, expenses: rows });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}

/* ─────────────────────────────────────────
   POST /api/expenses
   Ported from routes/expenses.js `POST /`.
───────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'expenses.add');
  if (denied) return denied;

  try {
    const body = await req.json();
    const { category_id, amount, description, created_at } = body;

    if (!amount) return NextResponse.json({ error: 'amount is required.' }, { status: 400 });
    if (isNaN(parseFloat(amount))) {
      return NextResponse.json({ error: 'amount must be a number.' }, { status: 400 });
    }

    const expense = await prisma.expense.create({
      data: {
        category_id: category_id || null,
        amount,
        description: description || null,
        created_at: created_at ? new Date(created_at) : new Date(),
      },
    });

    broadcast('expenses.changed', { action: 'added', expense_id: expense.expense_id });
    return NextResponse.json(
      {
        message: 'Expense recorded.',
        expense: withDateOnlyFields(
          { ...expense, amount: expense.amount == null ? null : Number(expense.amount) },
          ['created_at']
        ),
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}
