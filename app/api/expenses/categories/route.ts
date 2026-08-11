import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';

/* ─────────────────────────────────────────
   GET /api/expenses/categories
   Ported from routes/expenses.js `GET /categories`.
   Note: original returns the bare array (not {count, ...}) — preserved.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const categories = await prisma.expenseCategory.findMany({
      orderBy: { category_name: 'asc' },
    });
    return NextResponse.json(categories);
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}

/* ─────────────────────────────────────────
   POST /api/expenses/categories
   Ported from routes/expenses.js `POST /categories`.
───────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'expenses.categories');
  if (denied) return denied;

  try {
    const body = await req.json();
    const { category_name } = body;
    if (!category_name) {
      return NextResponse.json({ error: 'category_name is required.' }, { status: 400 });
    }

    const category = await prisma.expenseCategory.create({ data: { category_name } });

    broadcast('expense-categories.changed', { action: 'added', id: category.category_id });
    return NextResponse.json(category, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}
