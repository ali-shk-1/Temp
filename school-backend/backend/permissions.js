/**
 * permissions.js — single source of truth for the granular permission system.
 *
 * Roles: admin, principal, ali, viewer
 *   - ali     : top of hierarchy. ALWAYS has every permission. Cannot be
 *               restricted. Only ali can view/edit the Permissions page and
 *               change other users' passwords.
 *   - admin, principal, viewer : each permission below is toggle-able by ali.
 *               The DEFAULT values below exactly match the access those
 *               roles already had baked into the route files
 *               (authorize('admin'), authorize('admin','principal'),
 *               authorize('principal')) before this feature existed, so
 *               nothing changes for existing admin/principal accounts
 *               until ali actively changes something.
 *   - viewer  : brand new role. Every permission defaults to false — a
 *               viewer can log in, move between pages, and see data, but
 *               cannot add/edit/delete anything anywhere.
 *
 * PERMISSION_KEYS is the full list of togglable permissions, grouped by
 * page, with a human label used by the Permissions UI.
 */

const PERMISSION_GROUPS = [
  {
    key: 'students',
    label: 'Students',
    permissions: [
      { key: 'students.add',    label: 'Add student' },
      { key: 'students.edit',   label: 'Edit student' },
      { key: 'students.delete', label: 'Delete student' },
      { key: 'students.leave',  label: 'Mark student as left' },
    ],
  },
  {
    key: 'staff',
    label: 'Staff',
    permissions: [
      { key: 'staff.add',          label: 'Add staff' },
      { key: 'staff.edit',         label: 'Edit staff' },
      { key: 'staff.delete',       label: 'Delete staff' },
      { key: 'staff.designations', label: 'Manage designations' },
    ],
  },
  {
    key: 'fees',
    label: 'Fees',
    permissions: [
      { key: 'fees.add',    label: 'Record fee payment' },
      { key: 'fees.edit',   label: 'Edit fee payment' },
      { key: 'fees.delete', label: 'Delete fee payment' },
    ],
  },
  {
    key: 'expenses',
    label: 'Expenses',
    permissions: [
      { key: 'expenses.add',        label: 'Add expense' },
      { key: 'expenses.edit',       label: 'Edit expense' },
      { key: 'expenses.delete',     label: 'Delete expense' },
      { key: 'expenses.categories', label: 'Manage expense categories' },
    ],
  },
];

// Flat list of every permission key, in a stable order.
const PERMISSION_KEYS = PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => p.key));

// Roles whose permissions are toggle-able via the Permissions page.
// 'ali' is intentionally excluded — ali always has everything.
const MANAGEABLE_ROLES = ['admin', 'principal', 'viewer'];

/**
 * Hardcoded defaults — mirrors exactly what each role could already do via
 * authorize(...) in routes/*.js prior to this feature, so behavior for
 * existing admin/principal accounts is unchanged.
 */
const DEFAULT_PERMISSIONS = {
  admin: {
    'students.add': true,
    'students.edit': true,
    'students.delete': false,   // was authorize('principal') only
    'students.leave': true,     // was authorize('admin','principal')
    'staff.add': true,
    'staff.edit': true,
    'staff.delete': true,
    'staff.designations': true,
    'fees.add': true,
    'fees.edit': true,
    'fees.delete': true,
    'expenses.add': true,
    'expenses.edit': true,
    'expenses.delete': true,
    'expenses.categories': true,
  },
  principal: {
    'students.add': true,
    'students.edit': true,
    'students.delete': true,    // authorize('principal')
    'students.leave': true,
    'staff.add': false,         // staff.js is admin-only
    'staff.edit': false,
    'staff.delete': false,
    'staff.designations': false,
    'fees.add': true,
    'fees.edit': true,
    'fees.delete': true,
    'expenses.add': false,      // expenses.js is admin-only
    'expenses.edit': false,
    'expenses.delete': false,
    'expenses.categories': false,
  },
  viewer: {
    // Viewer can only ever look — nothing is on by default, and the
    // Permissions page for viewer starts fully off too.
    'students.add': false,
    'students.edit': false,
    'students.delete': false,
    'students.leave': false,
    'staff.add': false,
    'staff.edit': false,
    'staff.delete': false,
    'staff.designations': false,
    'fees.add': false,
    'fees.edit': false,
    'fees.delete': false,
    'expenses.add': false,
    'expenses.edit': false,
    'expenses.delete': false,
    'expenses.categories': false,
  },
};

/** ali always has every permission — not stored, not editable. */
function isAli(role) {
  return String(role || '').toLowerCase() === 'ali';
}

function defaultsForRole(role) {
  const r = String(role || '').toLowerCase();
  if (isAli(r)) {
    const all = {};
    PERMISSION_KEYS.forEach(k => { all[k] = true; });
    return all;
  }
  return DEFAULT_PERMISSIONS[r]
    ? { ...DEFAULT_PERMISSIONS[r] }
    : PERMISSION_KEYS.reduce((acc, k) => ({ ...acc, [k]: false }), {});
}

module.exports = {
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  MANAGEABLE_ROLES,
  DEFAULT_PERMISSIONS,
  isAli,
  defaultsForRole,
};
