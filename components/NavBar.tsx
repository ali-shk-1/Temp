/**
 * components/NavBar.tsx
 *
 * Port of renderNav() from nav.js. Renders the same markup/classes as
 * the original (`nav.navbar`, `.brand`, `.navbar-right`, etc.) so
 * style.css applies unchanged. Page-visibility filtering (hasPageAccess)
 * and the ali-only "Permissions" link match the original exactly.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getUser, logout, api } from '@/lib/api-client';
import { isAliUser, hasPageAccess } from '@/lib/permissions-client';
import { initTheme, toggleTheme } from '@/lib/theme';

const ALL_PAGES = [
  { href: '/dashboard', label: 'Dashboard', key: 'dashboard' },
  { href: '/fees', label: 'Fees', key: 'fees' },
  { href: '/receipts', label: 'Receipts', key: 'receipts' },
  { href: '/expenses', label: 'Expenses', key: 'expenses' },
  { href: '/tracking', label: 'Tracking', key: 'tracking' },
  { href: '/balance-sheet', label: 'Total', key: 'balance-sheet' },
  { href: '/students', label: 'Students', key: 'students' },
  { href: '/left-students', label: 'Left Students', key: 'left-students' },
  { href: '/staff', label: 'Staff', key: 'staff' },
  { href: '/left-staff', label: 'Left Staff', key: 'left-staff' },
] as const;

/**
 * Each page's primary GET endpoint(s), so hovering/focusing a nav link
 * can warm the shared GET cache (lib/api-client.ts) a beat before the
 * click actually navigates. On a fast local network this alone often
 * means the data is already cached by the time the new page mounts —
 * no spinner, no freeze. Cheap and safe: api() dedupes in-flight
 * requests, so a hover-then-click never fires the request twice.
 */
const PREFETCH_ENDPOINTS: Record<string, string[]> = {
  students: ['/api/students'],
  'left-students': ['/api/students/left'],
  staff: ['/api/staff', '/api/staff/designations'],
  'left-staff': ['/api/staff/left'],
  receipts: ['/api/fees/receipts'],
};

function prefetchPageData(key: string) {
  const endpoints = PREFETCH_ENDPOINTS[key];
  if (!endpoints) return;
  endpoints.forEach((path) => {
    void api('GET', path).catch(() => {});
  });
}

const THEME_ICON_SUN = (
  <svg className="theme-icon theme-icon-sun" width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="4.5" fill="currentColor" />
    <g stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <path d="M12 2v2.2M12 19.8V22M4.2 4.2l1.55 1.55M18.25 18.25l1.55 1.55M2 12h2.2M19.8 12H22M4.2 19.8l1.55-1.55M18.25 5.75l1.55-1.55" />
    </g>
  </svg>
);

const THEME_ICON_MOON = (
  <svg className="theme-icon theme-icon-moon" width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7z" fill="currentColor" />
  </svg>
);

/**
 * activePage: the page `key` to mark active. Pages pass their own key
 * (matches ALL_PAGES entries) exactly like renderNav(activePage) did.
 * refreshToken: bump this (e.g. from refreshMyPermissions) to force a
 * re-render after permissions/page-visibility change — mirrors the
 * original re-calling renderNav() from refreshMyPermissions().
 */
export default function NavBar({ activePage }: { activePage: string }) {
  const pathname = usePathname();
  const [, forceRerender] = useState(0);

  useEffect(() => {
    initTheme();
  }, []);

  const user = getUser();
  const pages = ALL_PAGES.filter((p) => p.key === 'dashboard' || hasPageAccess(p.key));
  const showPermissions = isAliUser();

  const handleToggleTheme = () => {
    toggleTheme();
    forceRerender((n) => n + 1);
  };

  return (
    <nav className="navbar">
      <Link className="brand" href="/dashboard">
        <img src="/icon-192.png" alt="" className="brand-icon" />
        <span>School Mgmt</span>
      </Link>
      <nav>
        {pages.map((p) => (
          <Link
            key={p.key}
            href={p.href}
            className={activePage === p.key || pathname === p.href ? 'active' : ''}
            onMouseEnter={() => prefetchPageData(p.key)}
            onFocus={() => prefetchPageData(p.key)}
          >
            {p.label}
          </Link>
        ))}
        {showPermissions && (
          <Link href="/permissions" className={activePage === 'permissions' ? 'active' : ''}>
            Permissions
          </Link>
        )}
        {showPermissions && (
          <Link href="/db-admin" className={activePage === 'db-admin' ? 'active' : ''}>
            DB Admin
          </Link>
        )}
      </nav>
      <div className="navbar-right">
        <button
          className="theme-toggle"
          id="themeToggleBtn"
          type="button"
          aria-label="Toggle dark mode"
          title="Toggle dark / light mode"
          onClick={handleToggleTheme}
        >
          {THEME_ICON_SUN}
          {THEME_ICON_MOON}
        </button>
        <span className="navbar-user">
          {user?.username || ''}
          {user?.role ? ` · ${user.role}` : ''}
        </span>
        <button className="logout-btn" onClick={() => logout()}>
          Logout
        </button>
      </div>
    </nav>
  );
}
