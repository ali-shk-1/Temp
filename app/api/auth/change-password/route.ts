import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   POST /api/auth/change-password
   Body: { current_password, new_password }
───────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const { current_password, new_password } = await req.json();

    if (!current_password || !new_password) {
      return NextResponse.json({ error: 'Both current and new password are required.' }, { status: 400 });
    }
    if (new_password.length < 6) {
      return NextResponse.json({ error: 'New password must be at least 6 characters.' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { user_id: auth.user.user_id } });
    if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 });

    const hash = await bcrypt.hash(new_password, 12);
    await prisma.user.update({ where: { user_id: auth.user.user_id }, data: { password_hash: hash } });

    return NextResponse.json({ message: 'Password changed successfully.' });
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}
