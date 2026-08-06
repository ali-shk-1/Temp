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
  { href: 'students.html',  label: 'Students',  key: 'students'  },
  { href: 'left-students.html', label: 'Left Students', key: 'left-students' },
  { href: 'staff.html',     label: 'Staff',     key: 'staff'     },
  { href: 'left-staff.html', label: 'Left Staff', key: 'left-staff' },
  { href: 'fees.html',      label: 'Fees',      key: 'fees'      },
  { href: 'expenses.html',  label: 'Expenses',  key: 'expenses'  },
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

let _lastRenderedNavPage = null;

function renderNav(activePage) {
  _lastRenderedNavPage = activePage;
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
      <a class="brand" href="dashboard.html">🏫 School Mgmt</a>
      <nav>${links}</nav>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="color:#ccc;font-size:14px;">${user.username || ''}${user.role ? ' · ' + user.role : ''}</span>
        <button class="logout-btn" onclick="logout()">Logout</button>
      </div>
    </nav>
  `;

  if (existing) {
    existing.replaceWith(nav.firstElementChild);
  } else {
    document.body.insertBefore(nav.firstElementChild, document.body.firstChild);
  }
}
