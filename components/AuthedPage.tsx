/**
 * components/AuthedPage.tsx
 *
 * Wraps a page's content with the same boilerplate every original HTML
 * page had: checkAuth() -> loadMyPermissions() -> renderNav(activePage),
 * plus the shared #toast host. Usage:
 *
 *   export default function StudentsPage() {
 *     return (
 *       <AuthedPage activePage="students">
 *         ...page content...
 *       </AuthedPage>
 *     );
 *   }
 *
 * Renders nothing until the auth check completes, to avoid a flash of
 * content before an unauthenticated redirect (the original relied on
 * full-page navigation for this; the SPA equivalent is a loading gate).
 */

'use client';

import { useEffect, useState } from 'react';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { loadMyPermissions } from '@/lib/permissions-client';
import NavBar from './NavBar';
import ToastHost from './ToastHost';

export default function AuthedPage({
  activePage,
  children,
}: {
  activePage: string;
  children: React.ReactNode;
}) {
  const { ready } = useAuthGuard();
  const [permsLoaded, setPermsLoaded] = useState(false);

  useEffect(() => {
    if (!ready) return;
    loadMyPermissions().finally(() => setPermsLoaded(true));
  }, [ready]);

  if (!ready || !permsLoaded) return null;

  return (
    <>
      <ToastHost />
      <NavBar activePage={activePage} />
      {children}
    </>
  );
}
