import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, authorizeRoles } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { PERMISSION_GROUPS, PERMISSION_KEYS, PAGE_KEYS, MANAGEABLE_ROLES, defaultsForRole } from '@/lib/permissions';

/* ─────────────────────────────────────────
   GET /api/permissions — ali only
   Ported from routes/permissions.js `GET /`.

   Everything in this file below /me is gated by authorize('ali') in the
   original (router.use(authenticate, authorize('ali'))). Next.js has no
   router-level middleware equivalent scoped to a sub-path, so each route
   in this folder (other than /me) repeats the same
   authorizeRoles(auth.user, 'ali') check individually.

   Returns the full permission matrix AND page-visibility matrix for
   admin, principal, vice_principal, accountant, and viewer, plus the
   username currently holding each role.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = authorizeRoles(auth.user, 'ali');
  if (denied) return denied;

  try {
    const permRows = await prisma.rolePermission.findMany({
      select: { role_name: true, permission_key: true, allowed: true },
    });
    const visRows = await prisma.rolePageVisibility.findMany({
      select: { role_name: true, page_key: true, visible: true },
    });
    const userRows = await prisma.user.findMany({
      where: { role: { role_name: { in: MANAGEABLE_ROLES } } },
      select: { user_id: true, username: true, is_active: true, role: { select: { role_name: true } } },
      orderBy: [{ role: { role_name: 'asc' } }, { username: 'asc' }],
    });
    const flatUsers = userRows.map((u) => ({
      user_id: u.user_id,
      username: u.username,
      is_active: u.is_active,
      role: u.role?.role_name,
    }));

    const result = MANAGEABLE_ROLES.map((role) => {
      const defaults = defaultsForRole(role);
      const stored: Record<string, boolean> = {};
      permRows
        .filter((r) => r.role_name === role)
        .forEach((r) => {
          stored[r.permission_key] = r.allowed;
        });

      const permissions: Record<string, boolean> = {};
      PERMISSION_KEYS.forEach((key) => {
        permissions[key] = Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : defaults[key];
      });

      const visStored: Record<string, boolean> = {};
      visRows
        .filter((v) => v.role_name === role)
        .forEach((v) => {
          visStored[v.page_key] = v.visible;
        });
      const page_visibility: Record<string, boolean> = {};
      PAGE_KEYS.forEach((p) => {
        // fail-open: no override row means visible
        page_visibility[p.key] = Object.prototype.hasOwnProperty.call(visStored, p.key) ? visStored[p.key] : true;
      });

      return {
        role,
        users: flatUsers.filter((u) => u.role === role),
        permissions,
        page_visibility,
      };
    });

    return NextResponse.json({ groups: PERMISSION_GROUPS, pages: PAGE_KEYS, roles: result });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
