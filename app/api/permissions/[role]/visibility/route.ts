import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, authorizeRoles } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';
import { MANAGEABLE_ROLES, PAGE_KEYS } from '@/lib/permissions';

/* ─────────────────────────────────────────
   PUT /api/permissions/:role/visibility — ali only
   Body: { page_key, visible }
   Ported from routes/permissions.js `PUT /:role/visibility`.
   Toggle whether an entire nav page (e.g. "Staff") is shown at all for
   every account holding this role. Distinct from PUT /:role, which
   toggles individual add/edit/delete actions — this hides the whole
   page/link instead.
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
    const { page_key, visible } = body;

    if (!MANAGEABLE_ROLES.includes(role)) {
      return NextResponse.json({ error: `role must be one of: ${MANAGEABLE_ROLES.join(', ')}.` }, { status: 400 });
    }
    if (!PAGE_KEYS.some((p) => p.key === page_key)) {
      return NextResponse.json({ error: 'Unknown page_key.' }, { status: 400 });
    }
    if (typeof visible !== 'boolean') {
      return NextResponse.json({ error: 'visible must be true or false.' }, { status: 400 });
    }

    await prisma.rolePageVisibility.upsert({
      where: { role_name_page_key: { role_name: role, page_key } },
      create: { role_name: role, page_key, visible, updated_at: new Date() },
      update: { visible, updated_at: new Date() },
    });

    broadcast('permissions.changed', { role, page_key, visible, action: 'visibility_updated' });
    return NextResponse.json({ message: 'Page visibility updated.', role, page_key, visible });
  } catch (err) {
    return handleApiError(err, 'PUT');
  }
}
