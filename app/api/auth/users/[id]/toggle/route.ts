import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { isAli } from '@/lib/permissions';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   PATCH /api/auth/users/:id/toggle — admin only
   Enable / disable a user account
───────────────────────────────────────── */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  const role = auth.user.role ? String(auth.user.role).toLowerCase() : null;
  if (!(role === 'admin' || isAli(role))) {
    return NextResponse.json({ error: 'Access denied. Required role(s): admin.' }, { status: 403 });
  }

  try {
    const { id } = await params;
    // Single atomic UPDATE ... RETURNING, matching the original's one
    // round-trip (avoids the findUnique-then-update race on concurrent toggles).
    const rows = await prisma.$queryRaw<
      { user_id: number; username: string; is_active: boolean }[]
    >`UPDATE users
      SET is_active = NOT is_active
      WHERE user_id = ${Number(id)}
      RETURNING user_id, username, is_active`;

    const user = rows[0];
    if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

    return NextResponse.json({ message: `Account ${user.is_active ? 'enabled' : 'disabled'}.`, user });
  } catch (err) {
    return handleApiError(err, 'PATCH');
  }
}
