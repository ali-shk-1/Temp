'use client';

/**
 * app/page.tsx — root route. The original app had no bare "/" page;
 * every page linked directly to login.html or dashboard.html. This just
 * forwards to whichever is appropriate, same logic as login.html's own
 * "already logged in" check.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/api-client';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getToken() ? '/dashboard' : '/login');
  }, [router]);

  return null;
}
