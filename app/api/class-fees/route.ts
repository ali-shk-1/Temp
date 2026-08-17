import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';

/* ─────────────────────────────────────────
   GET /api/class-fees
   Returns every class's global total fee, used by the Fees > Total Fee
   sub-page and by receipt printing (to compute the discount line).
   Readable by anyone authenticated — only add/edit/delete are gated.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const rows = await prisma.classFee.findMany({
      orderBy: { class_fee_id: 'asc' },
    });
    return NextResponse.json(rows);
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}

/* ─────────────────────────────────────────
   POST /api/class-fees
   Body: { class, total_fee }
   Creates (or, if the class already has a row, updates) the total fee
   for that class — kept idempotent since "one row per class" is the
   whole point of this table and a caller retrying/adding the same
   class shouldn't create a duplicate.
───────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'class-fees.add');
  if (denied) return denied;

  try {
    const body = await req.json();
    const cls = String(body.class || '').trim();
    const totalFee = Number(body.total_fee);

    if (!cls) {
      return NextResponse.json({ error: 'class is required.' }, { status: 400 });
    }
    if (!Number.isFinite(totalFee) || totalFee < 0) {
      return NextResponse.json({ error: 'total_fee must be a non-negative number.' }, { status: 400 });
    }

    const row = await prisma.classFee.upsert({
      where: { class: cls },
      update: { total_fee: totalFee, updated_by: auth.user.username || null },
      create: { class: cls, total_fee: totalFee, updated_by: auth.user.username || null },
    });

    broadcast('class-fees.changed', { action: 'saved', id: row.class_fee_id });
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}
