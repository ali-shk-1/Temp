import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, authorizeRoles } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';
import { MANAGEABLE_ROLES } from '@/lib/permissions';

/* ─────────────────────────────────────────
   PATCH /api/permissions/users/:user_id/toggle — ali only
   Ported from routes/permissions.js `PATCH /users/:user_id/toggle`.

   Enable/disable a role's account without deleting it — the account
   (and its role/permissions) is kept, just blocked from logging in.
   Mirrors PATCH /api/auth/users/:id/toggle, but scoped to the roles this
   page manages, and broadcasts permissions.changed instead of nothing
   so every open Permissions page updates live.
───────────────────────────────────────── */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ user_id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = authorizeRoles(auth.user, 'ali');
  if (denied) return denied;

  try {
    const { user_id } = await params;
    const target = await prisma.user.findUnique({
      where: { user_id: parseInt(user_id, 10) },
      select: { user_id: true, role: { select: { role_name: true } } },
    });
    if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    if (!target.role || !MANAGEABLE_ROLES.includes(String(target.role.role_name).toLowerCase())) {
      return NextResponse.json(
        { error: 'Can only enable/disable admin, principal, vice_principal, accountant, or viewer accounts.' },
        { status: 403 }
      );
    }

    const existing = await prisma.user.findUniqueOrThrow({
      where: { user_id: parseInt(user_id, 10) },
      select: { is_active: true },
    });
    const user = await prisma.user.update({
      where: { user_id: parseInt(user_id, 10) },
      data: { is_active: !existing.is_active },
      select: { user_id: true, username: true, is_active: true },
    });

    broadcast('permissions.changed', { action: 'user_toggled', user_id: user.user_id, is_active: user.is_active });
    return NextResponse.json({ message: `Account ${user.is_active ? 'enabled' : 'disabled'}.`, user });
  } catch (err) {
    return handleApiError(err, 'PATCH');
  }
}
