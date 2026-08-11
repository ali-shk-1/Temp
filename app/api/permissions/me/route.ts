import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { isAli, defaultsForRole, PAGE_KEYS, PERMISSION_KEYS, MANAGEABLE_ROLES } from '@/lib/permissions';

/* ─────────────────────────────────────────
   GET /api/permissions/me — any authenticated user
   Ported from routes/permissions.js `GET /me`.

   Returns the calling user's own effective permission map plus which nav
   pages are visible for their role. ali gets all-true/all-visible, any
   other/unknown role gets defaultsForRole's safe fallback, admin/
   principal/vice_principal/accountant/viewer get whatever ali has
   toggled (or hardcoded defaults if nothing's been toggled yet).
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const role = auth.user.role ? String(auth.user.role).toLowerCase() : null;
    if (!role) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });

    const page_visibility: Record<string, boolean> = {};
    PAGE_KEYS.forEach((p) => {
      page_visibility[p.key] = true;
    });
    if (!isAli(role) && MANAGEABLE_ROLES.includes(role)) {
      const visRows = await prisma.rolePageVisibility.findMany({
        where: { role_name: role },
        select: { page_key: true, visible: true },
      });
      visRows.forEach((v) => {
        page_visibility[v.page_key] = v.visible;
      });
    }

    if (isAli(role) || !MANAGEABLE_ROLES.includes(role)) {
      // ali -> all true. Any other/unknown role (shouldn't normally
      // happen) -> safe default of all false.
      return NextResponse.json({ role, permissions: defaultsForRole(role), page_visibility });
    }

    const rows = await prisma.rolePermission.findMany({
      where: { role_name: role },
      select: { permission_key: true, allowed: true },
    });
    const defaults = defaultsForRole(role);
    const permissions: Record<string, boolean> = {};
    PERMISSION_KEYS.forEach((key) => {
      permissions[key] = defaults[key];
    });
    rows.forEach((r) => {
      permissions[r.permission_key] = r.allowed;
    });

    return NextResponse.json({ role, permissions, page_visibility });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
