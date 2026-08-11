/**
 * lib/permissions.ts — ported 1:1 from the original backend/permissions.js.
 *
 * Roles: admin, principal, ali, viewer, vice_principal, accountant
 *   - ali     : top of hierarchy. ALWAYS has every permission. Cannot be
 *               restricted. Only ali can view/edit the Permissions page and
 *               change other users' passwords.
 *   - admin, principal, vice_principal, accountant, viewer : each
 *               permission below is toggle-able by ali.
 *   - viewer  : every permission defaults to false — a viewer can log in,
 *               move between pages, and see data, but cannot
 *               add/edit/delete anything anywhere.
 */

export interface PermissionDef {
  key: string;
  label: string;
}

export interface PermissionGroup {
  key: string;
  label: string;
  permissions: PermissionDef[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: 'students',
    label: 'Students',
    permissions: [
      { key: 'students.add', label: 'Add student' },
      { key: 'students.edit', label: 'Edit student' },
      { key: 'students.delete', label: 'Delete student' },
      { key: 'students.leave', label: 'Mark student as left' },
    ],
  },
  {
    key: 'left-students',
    label: 'Left Students',
    permissions: [
      { key: 'left-students.edit', label: 'Edit left student' },
      { key: 'left-students.delete', label: 'Delete left student' },
    ],
  },
  {
    key: 'staff',
    label: 'Staff',
    permissions: [
      { key: 'staff.add', label: 'Add staff' },
      { key: 'staff.edit', label: 'Edit staff' },
      { key: 'staff.delete', label: 'Delete staff' },
      { key: 'staff.leave', label: 'Mark staff as left' },
      { key: 'staff.designations', label: 'Manage designations' },
    ],
  },
  {
    key: 'left-staff',
    label: 'Left Staff',
    permissions: [
      { key: 'left-staff.edit', label: 'Edit left staff' },
      { key: 'left-staff.delete', label: 'Delete left staff' },
    ],
  },
  {
    key: 'fees',
    label: 'Fees',
    permissions: [
      { key: 'fees.add', label: 'Record fee payment' },
      { key: 'fees.edit', label: 'Edit fee payment' },
      { key: 'fees.delete', label: 'Delete fee payment' },
      { key: 'fees.custom_date', label: 'Deposit fee on a custom (backdated) date' },
    ],
  },
  {
    key: 'receipts',
    label: 'Receipts',
    permissions: [
      { key: 'receipts.add', label: 'Issue/print receipt' },
      { key: 'receipts.edit', label: 'Edit receipt' },
      { key: 'receipts.delete', label: 'Delete receipt' },
    ],
  },
  {
    key: 'expenses',
    label: 'Expenses',
    permissions: [
      { key: 'expenses.add', label: 'Add expense' },
      { key: 'expenses.edit', label: 'Edit expense' },
      { key: 'expenses.delete', label: 'Delete expense' },
      { key: 'expenses.categories', label: 'Manage expense categories' },
    ],
  },
  {
    key: 'tracking',
    label: 'Tracking',
    permissions: [
      { key: 'tracking.add', label: 'Add tracking entry' },
      { key: 'tracking.edit', label: 'Edit tracking entry' },
      { key: 'tracking.delete', label: 'Delete tracking entry' },
    ],
  },
  {
    key: 'balance-sheet',
    label: 'Total',
    permissions: [
      { key: 'balance-sheet.add', label: 'Add ledger entry' },
      { key: 'balance-sheet.edit', label: 'Edit ledger entry' },
      { key: 'balance-sheet.delete', label: 'Delete ledger entry' },
    ],
  },
];

export const PERMISSION_KEYS: string[] = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.key)
);

export const PAGE_KEYS: PermissionDef[] = [
  { key: 'students', label: 'Students' },
  { key: 'left-students', label: 'Left Students' },
  { key: 'staff', label: 'Staff' },
  { key: 'left-staff', label: 'Left Staff' },
  { key: 'fees', label: 'Fees' },
  { key: 'receipts', label: 'Receipts' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'tracking', label: 'Tracking' },
  { key: 'balance-sheet', label: 'Total' },
];

export const MANAGEABLE_ROLES: string[] = [
  'admin',
  'principal',
  'vice_principal',
  'accountant',
  'viewer',
];

type PermissionMap = Record<string, boolean>;

export const DEFAULT_PERMISSIONS: Record<string, PermissionMap> = {
  admin: {
    'students.add': true,
    'students.edit': true,
    'students.delete': false,
    'students.leave': true,
    'left-students.edit': true,
    'left-students.delete': false,
    'staff.add': true,
    'staff.edit': true,
    'staff.delete': true,
    'staff.leave': true,
    'staff.designations': true,
    'left-staff.edit': true,
    'left-staff.delete': true,
    'fees.add': true,
    'fees.edit': true,
    'fees.delete': true,
    'fees.custom_date': false,
    'receipts.add': true,
    'receipts.edit': true,
    'receipts.delete': false,
    'expenses.add': true,
    'expenses.edit': true,
    'expenses.delete': true,
    'expenses.categories': true,
    'tracking.add': true,
    'tracking.edit': true,
    'tracking.delete': false,
    'balance-sheet.add': false,
    'balance-sheet.edit': false,
    'balance-sheet.delete': false,
  },
  principal: {
    'students.add': true,
    'students.edit': true,
    'students.delete': true,
    'students.leave': true,
    'left-students.edit': true,
    'left-students.delete': true,
    'staff.add': false,
    'staff.edit': false,
    'staff.delete': false,
    'staff.leave': false,
    'staff.designations': false,
    'left-staff.edit': false,
    'left-staff.delete': false,
    'fees.add': true,
    'fees.edit': true,
    'fees.delete': true,
    'fees.custom_date': false,
    'receipts.add': true,
    'receipts.edit': false,
    'receipts.delete': false,
    'expenses.add': false,
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
  vice_principal: {
    'students.add': true,
    'students.edit': true,
    'students.delete': true,
    'students.leave': true,
    'left-students.edit': true,
    'left-students.delete': true,
    'staff.add': false,
    'staff.edit': false,
    'staff.delete': false,
    'staff.leave': false,
    'staff.designations': false,
    'left-staff.edit': false,
    'left-staff.delete': false,
    'fees.add': true,
    'fees.edit': true,
    'fees.delete': true,
    'fees.custom_date': false,
    'receipts.add': true,
    'receipts.edit': false,
    'receipts.delete': false,
    'expenses.add': false,
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
  accountant: {
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
    'fees.add': true,
    'fees.edit': true,
    'fees.delete': true,
    'fees.custom_date': false,
    'receipts.add': true,
    'receipts.edit': true,
    'receipts.delete': false,
    'expenses.add': true,
    'expenses.edit': true,
    'expenses.delete': true,
    'expenses.categories': true,
    'tracking.add': true,
    'tracking.edit': true,
    'tracking.delete': true,
    'balance-sheet.add': false,
    'balance-sheet.edit': false,
    'balance-sheet.delete': false,
  },
  viewer: {
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
    'fees.custom_date': false,
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
export function isAli(role?: string | null): boolean {
  return String(role || '').toLowerCase() === 'ali';
}

export function defaultsForRole(role?: string | null): PermissionMap {
  const r = String(role || '').toLowerCase();
  if (isAli(r)) {
    const all: PermissionMap = {};
    PERMISSION_KEYS.forEach((k) => {
      all[k] = true;
    });
    return all;
  }
  if (DEFAULT_PERMISSIONS[r]) return { ...DEFAULT_PERMISSIONS[r] };
  return PERMISSION_KEYS.reduce((acc, k) => ({ ...acc, [k]: false }), {} as PermissionMap);
}
