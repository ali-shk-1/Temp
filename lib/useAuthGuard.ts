/**
 * lib/useAuthGuard.ts — port of checkAuth() from api.js, as a hook every
 * authenticated page/layout calls at the top. Redirects to /login if no
 * token is present. Returns whether the check has completed and passed,
 * so pages can avoid rendering/fetching before redirect happens.
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, getUser, SessionUser } from './api-client';

export function useAuthGuard(): { ready: boolean; user: SessionUser | null } {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    setUser(getUser());
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ready, user };
}
