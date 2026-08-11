import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, authorizeRoles } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';
import { MANAGEABLE_ROLES, PERMISSION_KEYS } from '@/lib/permissions';

/* ─────────────────────────────────────────
   PUT /api/permissions/:role — ali only
   Body: { permission_key, allowed }
   Ported from routes/permissions.js `PUT /:role`.
   Toggle a single action permission (add/edit/delete/etc.) for admin,
   principal, vice_principal, accountant, or viewer.
───────────────────────────────────────── */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ role: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = authorizeRoles(auth.user, 'ali');
  if (denied) return denied;

  try {
    const { role: roleParam } = await params;
    const role = String(roleParam || '').toLowerCase();
    const body = await req.json();
    const { permission_key, allowed } = body;

    if (!MANAGEABLE_ROLES.includes(role)) {
      return NextResponse.json({ error: `role must be one of: ${MANAGEABLE_ROLES.join(', ')}.` }, { status: 400 });
    }
    if (!PERMISSION_KEYS.includes(permission_key)) {
      return NextResponse.json({ error: 'Unknown permission_key.' }, { status: 400 });
    }
    if (typeof allowed !== 'boolean') {
      return NextResponse.json({ error: 'allowed must be true or false.' }, { status: 400 });
    }

    await prisma.rolePermission.upsert({
      where: { role_name_permission_key: { role_name: role, permission_key } },
      create: { role_name: role, permission_key, allowed, updated_at: new Date() },
      update: { allowed, updated_at: new Date() },
    });

    broadcast('permissions.changed', { role, permission_key, allowed });
    return NextResponse.json({ message: 'Permission updated.', role, permission_key, allowed });
  } catch (err) {
    return handleApiError(err, 'PUT');
  }
}
