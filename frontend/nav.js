/**
 * nav.js — renders the top nav bar and exposes permission helpers used by
 * every page (students.html, staff.html, fees.html, expenses.html, etc.)
 * to show/hide add/edit/delete controls.
 *
 * Loaded AFTER api.js, so this renderNav definition is the one that wins.
 *
 * Roles:
 *   - ali     : sees every nav link + an extra "Permissions" link, and
 *               always has every permission (hasPerm always true).
 *   - viewer  : sees every nav link (can browse everywhere); hasPerm()
 *               reflects whatever ali has toggled for viewer, same as
 *               admin/principal below. Defaults to all-false only until
 *               ali turns something on.
 *   - admin / principal / viewer : hasPerm() reflects whatever ali has
 *               toggled for that role (fetched from /api/permissions/me
 *               once per session and cached in sessionStorage).
 */

const ALL_PAGES = [
  { href: 'dashboard.html', label: 'Dashboard', key: 'dashboard' },
  { href: 'fees.html',      label: 'Fees',      key: 'fees'      },
  { href: 'expenses.html',  label: 'Expenses',  key: 'expenses'  },
  { href: 'tracking.html',      label: 'Tracking', key: 'tracking'      },
  { href: 'balance-sheet.html', label: 'Total',     key: 'balance-sheet' },
  { href: 'students.html',  label: 'Students',  key: 'students'  },
  { href: 'left-students.html', label: 'Left Students', key: 'left-students' },
  { href: 'staff.html',     label: 'Staff',     key: 'staff'     },
  { href: 'left-staff.html', label: 'Left Staff', key: 'left-staff' },
];

function currentUserRole() {
  const user = JSON.parse(sessionStorage.getItem('user') || '{}');
  return String(user.role || '').toLowerCase();
}

function isAliUser() {
  return currentUserRole() === 'ali';
}

/**
 * hasPerm('students.add') -> true/false
 * - ali: always true
 * - admin/principal/viewer: read from the cached permission map, loaded
 *   via loadMyPermissions() (called once at the top of every page, right
 *   after checkAuth()). Defaults to false if not yet loaded, so buttons
 *   fail safe (hidden) rather than showing before we know for sure.
 */
function hasPerm(permissionKey) {
  const role = currentUserRole();
  if (role === 'ali') return true;
  try {
    const map = JSON.parse(sessionStorage.getItem('myPermissions') || '{}');
    return !!map[permissionKey];
  } catch {
    return false;
  }
}

/**
 * hasPageAccess('staff') -> true/false
 * Per-ROLE nav visibility, distinct from hasPerm() (which is per-role
 * action permissions but for individual add/edit/delete buttons). ali
 * always sees every page. For admin/principal/viewer, reflects whatever
 * ali toggled for that role via the Permissions page; defaults to
 * visible if never toggled.
 */
function hasPageAccess(pageKey) {
  const role = currentUserRole();
  if (role === 'ali') return true;
  try {
    const map = JSON.parse(sessionStorage.getItem('myPageVisibility') || '{}');
    return map[pageKey] !== false; // fail-open: undefined/missing = visible
  } catch {
    return true;
  }
}

/**
 * Fetches this session's effective permissions from the backend and
 * caches them in sessionStorage so hasPerm() can be used synchronously
 * while rendering the page. Call this once, near the top of each page,
 * right after checkAuth(). Safe to call for every role — for ali it's a
 * no-op since hasPerm() doesn't consult the cache for ali.
 */
async function loadMyPermissions() {
  const role = currentUserRole();
  if (role === 'ali') return;
  try {
    const res = await api('GET', '/api/permissions/me');
    if (res && res.permissions) {
      sessionStorage.setItem('myPermissions', JSON.stringify(res.permissions));
    }
    if (res && res.page_visibility) {
      sessionStorage.setItem('myPageVisibility', JSON.stringify(res.page_visibility));
    }
  } catch (err) {
    // If this fails (e.g. older backend without the route yet), fall back
    // to nothing cached — hasPerm() will return false and controls stay
    // hidden, which is the safe direction to fail in.
    console.warn('Could not load permissions:', err.message);
  }
}

/**
 * Called when a live 'permissions.changed' event arrives (see events.js)
 * for a non-ali user's own role. Re-fetches the permission map and, if
 * the current page defines applyPermissionUI() (most pages do, to
 * show/hide their add/edit/delete buttons), re-runs it so buttons update
 * without a manual refresh. Pages that don't define it are unaffected —
 * this is a no-op for them, same as before this feature existed.
 */
async function refreshMyPermissions() {
  await loadMyPermissions();
  if (typeof applyPermissionUI === 'function') {
    try { applyPermissionUI(); } catch (err) { console.warn('applyPermissionUI failed:', err.message); }
  }
  if (_lastRenderedNavPage) {
    try { renderNav(_lastRenderedNavPage); } catch (err) { console.warn('renderNav refresh failed:', err.message); }
  }
}

/* ============ THEME (light / dark) ============ */

const THEME_ICON_SUN = `<svg class="theme-icon theme-icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="12" cy="12" r="4.5" fill="currentColor"/>
  <g stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
    <path d="M12 2v2.2M12 19.8V22M4.2 4.2l1.55 1.55M18.25 18.25l1.55 1.55M2 12h2.2M19.8 12H22M4.2 19.8l1.55-1.55M18.25 5.75l1.55-1.55"/>
  </g>
</svg>`;

const THEME_ICON_MOON = `<svg class="theme-icon theme-icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7z" fill="currentColor"/>
</svg>`;

/**
 * Reads the saved theme (or falls back to OS preference on first visit)
 * and applies it to <html data-theme="..."> before the page paints.
 * Called both from the inline <head> snippet (to avoid a flash of the
 * wrong theme) and again here so the toggle button reflects the right
 * icon once nav.js has loaded.
 */
function initTheme() {
  let theme = localStorage.getItem('theme');
  if (!theme) {
    theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}

let _lastRenderedNavPage = null;

function renderNav(activePage) {
  _lastRenderedNavPage = activePage;
  initTheme();
  const existing = document.querySelector('nav.navbar');
  const user = JSON.parse(sessionStorage.getItem('user') || '{}');
  // Per-role page visibility: hide whole nav links ali has turned off for
  // this role (dashboard is never filtered — everyone needs somewhere to
  // land after login).
  const pages = ALL_PAGES.filter(p => p.key === 'dashboard' || hasPageAccess(p.key));

  if (isAliUser()) {
    pages.push({ href: 'permissions.html', label: 'Permissions', key: 'permissions' });
  }

  const links = pages.map(p =>
    `<a href="${p.href}" class="${activePage === p.key ? 'active' : ''}">${p.label}</a>`
  ).join('');

  const nav = document.createElement('div');
  nav.innerHTML = `
    <nav class="navbar">
      <a class="brand" href="dashboard.html"><img src="icon-192.png" alt="" class="brand-icon"/><span>School Mgmt</span></a>
      <nav>${links}</nav>
      <div class="navbar-right">
        <button class="theme-toggle" id="themeToggleBtn" type="button" aria-label="Toggle dark mode" title="Toggle dark / light mode">${THEME_ICON_SUN}${THEME_ICON_MOON}</button>
        <span class="navbar-user">${user.username || ''}${user.role ? ' · ' + user.role : ''}</span>
        <button class="logout-btn" onclick="logout()">Logout</button>
      </div>
    </nav>
  `;

  if (existing) {
    existing.replaceWith(nav.firstElementChild);
  } else {
    document.body.insertBefore(nav.firstElementChild, document.body.firstChild);
  }

  const toggleBtn = document.getElementById('themeToggleBtn');
  if (toggleBtn) toggleBtn.addEventListener('click', toggleTheme);
}
