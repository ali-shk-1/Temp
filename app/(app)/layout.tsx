'use client';

/**
 * app/(app)/layout.tsx
 *
 * Shared shell for every authenticated page (dashboard, students, fees,
 * staff, tracking, receipts, expenses, etc.) — anything under the
 * `(app)` route group.
 *
 * WHY THIS FILE EXISTS (perf fix):
 * Previously each page wrapped its own content in <AuthedPage>, which
 * ran the auth guard + permissions fetch + rendered the NavBar fresh on
 * every single page component. Because Next.js treats each page/page.tsx
 * as its own tree, navigating from e.g. Dashboard -> Fees unmounted the
 * ENTIRE previous page (NavBar included) and rendered nothing (`null`)
 * until:
 *   1. useAuthGuard's effect ran (one blank frame minimum), then
 *   2. loadMyPermissions() made a real network round-trip to
 *      /api/permissions/me — on every single navigation, even between
 *      tabs you'd already visited seconds ago.
 * That's the white-flash-then-reload / "frozen for a second" feeling:
 * the whole screen (including the nav bar) went blank and came back.
 *
 * With this layout, the NavBar and the auth/permissions check live
 * ABOVE the per-page `children` in the component tree. React Router
 * (App Router) keeps this layout mounted across navigations within the
 * group, so switching tabs only swaps the inner page content — the
 * NavBar never unmounts, and permissions are fetched once per session
 * (see permissions-client's short-lived cache) instead of once per
 * click.
 */

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { loadMyPermissions } from '@/lib/permissions-client';
import NavBar from '@/components/NavBar';
import ToastHost from '@/components/ToastHost';

// Maps a pathname to the NavBar's `activePage` key. Kept in one place
// so every page no longer needs to pass its own activePage prop.
function activePageFromPath(pathname: string): string {
  const seg = pathname.split('/').filter(Boolean)[0] || 'dashboard';
  return seg;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { ready } = useAuthGuard();
  const [permsLoaded, setPermsLoaded] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!ready) return;
    // loadMyPermissions() is now called once when the authenticated
    // shell first mounts (session start / hard refresh) rather than on
    // every page navigation — see lib/permissions-client.ts for the
    // in-memory short-TTL cache that also protects direct callers.
    loadMyPermissions().finally(() => setPermsLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Only the very first mount of the authenticated shell (fresh login,
  // hard refresh, or opening a new tab) waits on auth+permissions.
  // Every navigation after that reuses this already-mounted layout.
  if (!ready || !permsLoaded) {
    return (
      <div className="app-shell-loading" aria-hidden="true">
        <div className="app-shell-loading-bar" />
      </div>
    );
  }

  return (
    <>
      <ToastHost />
      <NavBar activePage={activePageFromPath(pathname)} />
      {/* key={pathname} restarts the fade-in animation (see
          .app-page-transition in style.css) on every route change,
          giving a smooth crossfade instead of new content snapping in
          — while the NavBar/ToastHost above stay mounted throughout,
          so they never re-flash. */}
      <div className="app-page-transition" key={pathname}>
        {children}
      </div>
    </>
  );
}
