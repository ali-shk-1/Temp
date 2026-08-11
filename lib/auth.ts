import jwt from 'jsonwebtoken';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from './prisma';
import { isAli, defaultsForRole } from './permissions';

export interface JwtPayload {
  user_id: number;
  username: string;
  role: string;
  staff_id: number | null;
}

/**
 * Ported from middleware/authMiddleware.js `authenticate`.
 * Reads Authorization: Bearer <token>, or ?token= query param (needed for
 * EventSource, which can't set custom headers — see /api/events route).
 * Returns the decoded payload, or a NextResponse to return immediately
 * (401/403) if verification fails.
 */
export function authenticate(
  req: NextRequest
): { user: JwtPayload } | { error: NextResponse } {
  const authHeader = req.headers.get('authorization');
  let token: string | null = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else {
    const tokenParam = req.nextUrl.searchParams.get('token');
    if (tokenParam) token = tokenParam;
  }

  if (!token) {
    return {
      error: NextResponse.json({ error: 'No token provided. Access denied.' }, { status: 401 }),
    };
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    return { user: decoded };
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return {
        error: NextResponse.json({ error: 'Token expired. Please log in again.' }, { status: 401 }),
      };
    }
    return { error: NextResponse.json({ error: 'Invalid token.' }, { status: 403 }) };
  }
}

/**
 * Ported from middleware/authMiddleware.js `authorize(...roles)`.
 * Plain role allow-list check (used for a handful of ali/admin-only routes).
 */
export function authorizeRoles(user: JwtPayload, ...roles: string[]): NextResponse | null {
  const normalizedRoles = roles.map((r) => r.toLowerCase());
  const userRole = user.role ? user.role.toLowerCase() : null;
  if (!userRole || !normalizedRoles.includes(userRole)) {
    return NextResponse.json(
      { error: `Access denied. Required role(s): ${roles.join(', ')}.` },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Ported from middleware/authMiddleware.js `can(permissionKey)`.
 * - 'ali' always passes.
 * - Otherwise looks up role_permissions; falls back to hardcoded defaults
 *   in lib/permissions.ts if no row exists yet.
 * Returns null if allowed, or a NextResponse(403) to return immediately.
 */
export async function can(user: JwtPayload, permissionKey: string): Promise<NextResponse | null> {
  const role = user.role ? user.role.toLowerCase() : null;
  if (!role) {
    return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  }
  if (isAli(role)) return null;

  const row = await prisma.rolePermission.findUnique({
    where: { role_name_permission_key: { role_name: role, permission_key: permissionKey } },
  });

  let allowed: boolean;
  if (row) {
    allowed = row.allowed;
  } else {
    const defaults = defaultsForRole(role);
    allowed = !!defaults[permissionKey];
  }

  if (!allowed) {
    return NextResponse.json(
      { error: `Access denied. You don't have permission to do this (${permissionKey}).` },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Mirrors fees.js `userHasPermission` — a plain boolean check (not
 * middleware), used where a request should still succeed even if a
 * secondary permission (e.g. fees.custom_date) is denied.
 */
export async function userHasPermission(role: string | null | undefined, permissionKey: string): Promise<boolean> {
  const normalizedRole = String(role || '').toLowerCase();
  if (isAli(normalizedRole)) return true;
  const row = await prisma.rolePermission.findUnique({
    where: { role_name_permission_key: { role_name: normalizedRole, permission_key: permissionKey } },
  });
  if (row) return !!row.allowed;
  return !!defaultsForRole(normalizedRole)[permissionKey];
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, process.env.JWT_SECRET as string, {
    expiresIn: (process.env.JWT_EXPIRES_IN || '8h') as any,
  });
}
