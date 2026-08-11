import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   GET /api/auth/me — verify token + return profile
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const user = await prisma.user.findUnique({
      where: { user_id: auth.user.user_id },
      include: { role: true, staff: true },
    });
    // Original query used INNER JOIN roles — a user with no matching role
    // would return 0 rows there too. Mirror that as "not found".
    if (!user || !user.role) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

    return NextResponse.json({
      user_id: user.user_id,
      username: user.username,
      role: user.role.role_name,
      staff_id: user.staff_id,
      last_login: user.last_login,
      created_at: user.created_at,
      staff_name: user.staff ? user.staff.name : null,
    });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
