import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

/**
 * Ported from middleware/errorHandler.js. Express used raw `pg` error codes
 * (err.code === '23505' etc). Prisma wraps the same underlying Postgres
 * errors as PrismaClientKnownRequestError with its own P-codes:
 *   P2002 -> unique constraint violation      (was pg 23505)
 *   P2003 -> foreign key constraint violation (was pg 23503)
 *   P2011 / P2012 -> null constraint violation (was pg 23502)
 *
 * method: pass the HTTP method of the route so the FK-violation message can
 * match the original's DELETE-vs-other-methods phrasing distinction.
 */
export function handleApiError(err: unknown, method: string): NextResponse {
  console.error(`[${new Date().toISOString()}] ${method} →`, err);

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Unique violation (was pg 23505)
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'Duplicate entry. Record already exists.' }, { status: 409 });
    }

    // Foreign key violation (was pg 23503) — fires in both directions:
    //  (a) insert/update pointing at a parent row that doesn't exist
    //  (b) delete of a row still referenced by other rows
    if (err.code === 'P2003') {
      if (method === 'DELETE') {
        return NextResponse.json(
          { error: 'This record is still referenced by other data and cannot be removed. Update or remove those first.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: 'Referenced record does not exist.' }, { status: 400 });
    }

    // Record not found on update/delete (Prisma-specific; Express+raw SQL
    // would have just returned 0 rows, handled per-route with a 404 check
    // — kept here as a safety net in case a route relies on this instead).
    if (err.code === 'P2025') {
      return NextResponse.json({ error: 'Record not found.' }, { status: 404 });
    }

    // Required field missing (was pg 23502)
    if (err.code === 'P2011' || err.code === 'P2012') {
      return NextResponse.json({ error: `Required field missing.` }, { status: 400 });
    }
  }

  const message = err instanceof Error ? err.message : 'Internal server error.';
  return NextResponse.json({ error: message || 'Internal server error.' }, { status: 500 });
}
