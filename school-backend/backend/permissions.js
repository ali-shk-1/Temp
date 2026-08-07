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
    key: 'left-students',
    label: 'Left Students',
    permissions: [
      { key: 'left-students.edit',   label: 'Edit left student' },
      { key: 'left-students.delete', label: 'Delete left student' },
    ],
  },
  {
    key: 'staff',
    label: 'Staff',
    permissions: [
      { key: 'staff.add',          label: 'Add staff' },
      { key: 'staff.edit',         label: 'Edit staff' },
      { key: 'staff.delete',       label: 'Delete staff' },
      { key: 'staff.leave',        label: 'Mark staff as left' },
      { key: 'staff.designations', label: 'Manage designations' },
    ],
  },
  {
    key: 'left-staff',
    label: 'Left Staff',
    permissions: [
      { key: 'left-staff.edit',   label: 'Edit left staff' },
      { key: 'left-staff.delete', label: 'Delete left staff' },
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
    key: 'receipts',
    label: 'Receipts',
    permissions: [
      { key: 'receipts.add',    label: 'Issue/print receipt' },
      { key: 'receipts.edit',   label: 'Edit receipt' },
      { key: 'receipts.delete', label: 'Delete receipt' },
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
  {
    key: 'tracking',
    label: 'Tracking',
    permissions: [
      { key: 'tracking.add',    label: 'Add tracking entry' },
      { key: 'tracking.edit',   label: 'Edit tracking entry' },
      { key: 'tracking.delete', label: 'Delete tracking entry' },
    ],
  },
  {
    key: 'balance-sheet',
    label: 'Total',
    permissions: [
      { key: 'balance-sheet.add',    label: 'Add ledger entry' },
      { key: 'balance-sheet.edit',   label: 'Edit ledger entry' },
      { key: 'balance-sheet.delete', label: 'Delete ledger entry' },
    ],
  },
];

// Flat list of every permission key, in a stable order.
const PERMISSION_KEYS = PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => p.key));

// Pages that can be individually hidden per-user via user_page_visibility
// (see routes/permissions.js PUT /api/permissions/users/:user_id/visibility).
// 'dashboard' is deliberately excluded — every logged-in user always needs
// somewhere to land after login. 'permissions' and 'users' are ali-only
// pages, never shown to anyone else regardless of this table, so they're
// excluded too. Keys and labels mirror ALL_PAGES in frontend/nav.js.
const PAGE_KEYS = [
  { key: 'students',      label: 'Students' },
  { key: 'left-students',  label: 'Left Students' },
  { key: 'staff',          label: 'Staff' },
  { key: 'left-staff',     label: 'Left Staff' },
  { key: 'fees',           label: 'Fees' },
  { key: 'receipts',       label: 'Receipts' },
  { key: 'expenses',       label: 'Expenses' },
  { key: 'tracking',       label: 'Tracking' },
  { key: 'balance-sheet',  label: 'Total' },
];

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
    'left-students.edit': true,     // mirrors prior students.edit behavior
    'left-students.delete': false,  // mirrors prior students.delete behavior
    'staff.add': true,
    'staff.edit': true,
    'staff.delete': true,
    'staff.leave': true,
    'staff.designations': true,
    'left-staff.edit': true,        // mirrors prior staff.edit behavior
    'left-staff.delete': true,      // mirrors prior staff.delete behavior
    'fees.add': true,
    'fees.edit': true,
    'fees.delete': true,
    'receipts.add': true,
    'receipts.edit': true,
    'receipts.delete': false,   // deleting a receipt removes an audit record — admin-restricted by default
    'expenses.add': true,
    'expenses.edit': true,
    'expenses.delete': true,
    'expenses.categories': true,
    'tracking.add': true,
    'tracking.edit': true,
    'tracking.delete': false,
    'balance-sheet.add': false,   // Total is a computed report, not directly editable, by default
    'balance-sheet.edit': false,
    'balance-sheet.delete': false,
  },
  principal: {
    'students.add': true,
    'students.edit': true,
    'students.delete': true,    // authorize('principal')
    'students.leave': true,
    'left-students.edit': true,     // mirrors prior students.edit behavior
    'left-students.delete': true,   // mirrors prior students.delete behavior
    'staff.add': false,         // staff.js is admin-only
    'staff.edit': false,
    'staff.delete': false,
    'staff.leave': false,
    'staff.designations': false,
    'left-staff.edit': false,       // mirrors prior staff.edit behavior
    'left-staff.delete': false,     // mirrors prior staff.delete behavior
    'fees.add': true,
    'fees.edit': true,
    'fees.delete': true,
    'receipts.add': true,
    'receipts.edit': false,
    'receipts.delete': false,
    'expenses.add': false,      // expenses.js is admin-only
    'expenses.edit': false,
    'expenses.delete': false,
    'expenses.categories': false,
    'tracking.add': true,
    'tracking.edit': true,
    'tracking.delete': false,
    'balance-sheet.add': false,
    'balance-sheet.edit': false,
    'balance-sheet.delete': false,
  },
  viewer: {
    // Viewer can only ever look — nothing is on by default, and the
    // Permissions page for viewer starts fully off too.
    'students.add': false,
    'students.edit': false,
    'students.delete': false,
    'students.leave': false,
    'left-students.edit': false,
    'left-students.delete': false,
    'staff.add': false,
    'staff.edit': false,
    'staff.delete': false,
    'staff.leave': false,
    'staff.designations': false,
    'left-staff.edit': false,
    'left-staff.delete': false,
    'fees.add': false,
    'fees.edit': false,
    'fees.delete': false,
    'receipts.add': false,
    'receipts.edit': false,
    'receipts.delete': false,
    'expenses.add': false,
    'expenses.edit': false,
    'expenses.delete': false,
    'expenses.categories': false,
    'tracking.add': false,
    'tracking.edit': false,
    'tracking.delete': false,
    'balance-sheet.add': false,
    'balance-sheet.edit': false,
    'balance-sheet.delete': false,
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
  PAGE_KEYS,
  MANAGEABLE_ROLES,
  DEFAULT_PERMISSIONS,
  isAli,
  defaultsForRole,
};
