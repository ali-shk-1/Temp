import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { isAli } from '@/lib/permissions';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   POST /api/auth/register — admin only
   Body: { username, password, role_id, staff_id? }
───────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  const role = auth.user.role ? String(auth.user.role).toLowerCase() : null;
  if (!(role === 'admin' || isAli(role))) {
    return NextResponse.json({ error: 'Access denied. Required role(s): admin.' }, { status: 403 });
  }

  try {
    const { username, password, role_id, staff_id } = await req.json();

    if (!username || !password || !role_id) {
      return NextResponse.json({ error: 'username, password, and role_id are required.' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    }

    // Block minting a second 'ali' account through this endpoint.
    const roleRow = await prisma.role.findUnique({ where: { role_id: Number(role_id) } });
    if (!roleRow) {
      return NextResponse.json({ error: 'Invalid role_id.' }, { status: 400 });
    }
    if (String(roleRow.role_name).toLowerCase() === 'ali') {
      return NextResponse.json({ error: 'The ali role cannot be assigned through registration.' }, { status: 403 });
    }

    const hash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        username,
        password_hash: hash,
        role_id: Number(role_id),
        staff_id: staff_id || null,
      },
      select: { user_id: true, username: true, role_id: true, staff_id: true, created_at: true },
    });

    return NextResponse.json({ message: 'User created.', user }, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}
