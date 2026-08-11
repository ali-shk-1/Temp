import { NextRequest, NextResponse } from 'next/server';
import { authenticate, authorizeRoles } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { TABLE_REGISTRY } from '@/lib/db-admin/table-registry';
import { prisma } from '@/lib/prisma';
import { getDelegate } from '@/lib/db-admin/helpers';

/* ─────────────────────────────────────────
   GET /api/db-admin/tables
   Ali-only. Lists every allowlisted table plus a live row count for each,
   for the DB admin viewer's landing page.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = authorizeRoles(auth.user, 'ali');
  if (denied) return denied;

  try {
    const tables = await Promise.all(
      TABLE_REGISTRY.map(async (entry) => {
        const delegate = getDelegate(entry);
        const count = await delegate.count();
        return {
          table: entry.dbTable,
          label: entry.label,
          pk: entry.pk,
          count,
        };
      })
    );

    return NextResponse.json({ tables });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
