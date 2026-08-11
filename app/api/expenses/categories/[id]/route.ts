import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';

/* ─────────────────────────────────────────
   DELETE /api/expenses/categories/:id
   Ported from routes/expenses.js `DELETE /categories/:id`.
   Gated by can('expenses.categories'), which defaults to admin-only but
   is toggleable per-role by ali from the Permissions page.
───────────────────────────────────────── */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'expenses.categories');
  if (denied) return denied;

  try {
    const { id } = await params;
    let category;
    try {
      category = await prisma.expenseCategory.delete({
        where: { category_id: parseInt(id, 10) },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return NextResponse.json({ error: 'Category not found.' }, { status: 404 });
      }
      throw err;
    }

    broadcast('expense-categories.changed', { action: 'deleted', id: category.category_id });
    return NextResponse.json({ message: 'Category deleted.' });
  } catch (err) {
    return handleApiError(err, 'DELETE');
  }
}
