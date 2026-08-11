import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { signToken } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   POST /api/auth/login
   Body: { username, password }
───────────────────────────────────────── */
export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { username },
      include: { role: true },
    });

    // role_id is nullable at the DB level (no NOT NULL/FK-required
    // constraint in the real schema), but the original query used an
    // INNER JOIN roles — meaning a user row with no matching role could
    // never log in. Mirror that exactly here.
    if (!user || !user.role) {
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
    }

    if (!user.is_active) {
      return NextResponse.json({ error: 'Account is disabled. Contact administrator.' }, { status: 403 });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
    }

    await prisma.user.update({
      where: { user_id: user.user_id },
      data: { last_login: new Date() },
    });

    const token = signToken({
      user_id: user.user_id,
      username: user.username,
      role: user.role.role_name,
      staff_id: user.staff_id,
    });

    return NextResponse.json({
      message: 'Login successful.',
      token,
      user: { user_id: user.user_id, username: user.username, role: user.role.role_name },
    });
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}
