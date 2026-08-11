import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { authenticate, authorizeRoles } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { MANAGEABLE_ROLES } from '@/lib/permissions';

/* ─────────────────────────────────────────
   POST /api/permissions/users/:user_id/password — ali only
   Body: { new_password }
   Ported from routes/permissions.js `POST /users/:user_id/password`.
   ali resets the password for an admin/principal/vice_principal/
   accountant/viewer account. No broadcast in the original — preserved.
───────────────────────────────────────── */
export async function POST(req: NextRequest, { params }: { params: Promise<{ user_id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = authorizeRoles(auth.user, 'ali');
  if (denied) return denied;

  try {
    const { user_id } = await params;
    const userId = parseInt(user_id, 10);
    const body = await req.json();
    const { new_password } = body;

    if (!new_password || new_password.length < 6) {
      return NextResponse.json(
        { error: 'new_password is required and must be at least 6 characters.' },
        { status: 400 }
      );
    }

    const target = await prisma.user.findUnique({
      where: { user_id: userId },
      select: { user_id: true, username: true, role: { select: { role_name: true } } },
    });
    if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    if (!target.role || !MANAGEABLE_ROLES.includes(String(target.role.role_name).toLowerCase())) {
      return NextResponse.json(
        { error: 'Can only reset passwords for admin, principal, or viewer accounts.' },
        { status: 403 }
      );
    }

    const hash = await bcrypt.hash(new_password, 12);
    await prisma.user.update({ where: { user_id: target.user_id }, data: { password_hash: hash } });

    return NextResponse.json({ message: `Password updated for "${target.username}".` });
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}
