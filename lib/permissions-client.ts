/**
 * lib/permissions-client.ts
 *
 * Port of the permission-helper portion of nav.js: currentUserRole,
 * isAliUser, hasPerm, hasPageAccess, loadMyPermissions. Kept separate
 * from the nav bar itself (that's components/NavBar.tsx) since these
 * are used standalone by page components to show/hide add/edit/delete
 * controls (`applyPermissionUI` in the original).
 */

'use client';

import { api, getUser } from './api-client';

export function currentUserRole(): string {
  const user = getUser();
  return String(user?.role || '').toLowerCase();
}

export function isAliUser(): boolean {
  return currentUserRole() === 'ali';
}

/**
 * hasPerm('students.add') -> true/false
 * - ali: always true
 * - everyone else: read from the cached permission map (sessionStorage,
 *   populated by loadMyPermissions()). Defaults to false if not yet
 *   loaded, so controls fail safe (hidden) rather than flashing visible.
 */
export function hasPerm(permissionKey: string): boolean {
  const role = currentUserRole();
  if (role === 'ali') return true;
  if (typeof window === 'undefined') return false;
  try {
    const map = JSON.parse(sessionStorage.getItem('myPermissions') || '{}');
    return !!map[permissionKey];
  } catch {
    return false;
  }
}

/**
 * hasPageAccess('staff') -> true/false
 * Per-role nav visibility. ali always sees every page; everyone else
 * fails OPEN (undefined/missing = visible) unless ali explicitly hid it.
 */
export function hasPageAccess(pageKey: string): boolean {
  const role = currentUserRole();
  if (role === 'ali') return true;
  if (typeof window === 'undefined') return true;
  try {
    const map = JSON.parse(sessionStorage.getItem('myPageVisibility') || '{}');
    return map[pageKey] !== false;
  } catch {
    return true;
  }
}

/**
 * Fetches this session's effective permissions from the backend and
 * caches them in sessionStorage so hasPerm()/hasPageAccess() can be used
 * synchronously while rendering. Call once near the top of each
 * authenticated page/layout, after confirming the user is logged in.
 * Safe to call for every role — for ali it's a no-op.
 */
export async function loadMyPermissions(): Promise<void> {
  const role = currentUserRole();
  if (role === 'ali') return;
  try {
    const res = await api<{ permissions?: Record<string, boolean>; page_visibility?: Record<string, boolean> }>(
      'GET',
      '/api/permissions/me'
    );
    if (res?.permissions) {
      sessionStorage.setItem('myPermissions', JSON.stringify(res.permissions));
    }
    if (res?.page_visibility) {
      sessionStorage.setItem('myPageVisibility', JSON.stringify(res.page_visibility));
    }
  } catch (err: any) {
    // Fail safe: nothing cached -> hasPerm() returns false, controls stay hidden.
    // eslint-disable-next-line no-console
    console.warn('Could not load permissions:', err?.message);
  }
}

/**
 * Port of refreshMyPermissions() from nav.js. Called when a live
 * 'permissions.changed' event arrives for a non-ali user's own role:
 * re-fetches the permission map and invokes the given callback (the
 * page's applyPermissionUI() equivalent) so controls update without a
 * manual refresh. The nav bar itself re-renders on its own since it
 * reads hasPageAccess()/isAliUser() fresh on every render.
 */
export async function refreshMyPermissions(onUpdated?: () => void): Promise<void> {
  await loadMyPermissions();
  if (onUpdated) {
    try {
      onUpdated();
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn('applyPermissionUI failed:', err?.message);
    }
  }
}
