/**
 * lib/db-admin/table-registry.ts
 *
 * Allowlist of Prisma models exposed through the ali-only DB admin viewer
 * (phpMyAdmin-style: table list -> row browser -> inline edit/delete).
 *
 * This is a *hand-maintained* allowlist, not a dynamic dump of every
 * Prisma model — the DB viewer must never expose more than we explicitly
 * decide to. Every entry below was cross-checked against
 * prisma/schema.prisma (see that file's own header) for accessor name,
 * primary key field(s), and @map table name.
 *
 * `prismaModel` is the lowerCamelCase accessor used on the Prisma client
 * (e.g. `prisma.student`), matching the model name in schema.prisma with
 * its first letter lower-cased. `dbTable` is the underlying @@map name,
 * shown to the user as the "real" table name.
 *
 * `pk` lists the primary key field name(s) in DB-column order. All models
 * in this schema use a single-column PK (autoincrement Int), so this is
 * always length 1 today, but the shape supports composite keys if that
 * ever changes.
 *
 * `excludeColumns` lists fields that must never be sent to the client or
 * accepted from the client on edit — currently just password_hash on
 * User, which must not round-trip through a generic viewer/editor.
 */

export interface TableRegistryEntry {
  /** Prisma client accessor, e.g. prisma.student */
  prismaModel: string;
  /** Underlying Postgres table name (from @@map), shown to the user */
  dbTable: string;
  /** Human label for the table list UI */
  label: string;
  /** Primary key field name(s), in column order */
  pk: string[];
  /** Fields to strip from every response and reject on every write */
  excludeColumns?: string[];
}

export const TABLE_REGISTRY: TableRegistryEntry[] = [
  { prismaModel: 'role', dbTable: 'roles', label: 'Roles', pk: ['role_id'] },
  {
    prismaModel: 'user',
    dbTable: 'users',
    label: 'Users',
    pk: ['user_id'],
    excludeColumns: ['password_hash'],
  },
  {
    prismaModel: 'rolePermission',
    dbTable: 'role_permissions',
    label: 'Role Permissions',
    pk: ['role_name', 'permission_key'],
  },
  {
    prismaModel: 'rolePageVisibility',
    dbTable: 'role_page_visibility',
    label: 'Role Page Visibility',
    pk: ['role_name', 'page_key'],
  },
  { prismaModel: 'student', dbTable: 'students', label: 'Students', pk: ['student_id'] },
  {
    prismaModel: 'leftStudent',
    dbTable: 'left_students',
    label: 'Left Students',
    pk: ['left_student_id'],
  },
  {
    prismaModel: 'leftStudentFeePayment',
    dbTable: 'left_student_fee_payments',
    label: 'Left Student Fee Payments',
    pk: ['left_fee_payment_id'],
  },
  {
    prismaModel: 'designation',
    dbTable: 'designations',
    label: 'Designations',
    pk: ['id'],
  },
  { prismaModel: 'staff', dbTable: 'staff', label: 'Staff', pk: ['staff_id'] },
  {
    prismaModel: 'leftStaff',
    dbTable: 'left_staff',
    label: 'Left Staff',
    pk: ['left_staff_id'],
  },
  {
    prismaModel: 'feePayment',
    dbTable: 'fee_payments',
    label: 'Fee Payments',
    pk: ['payment_id'],
  },
  {
    prismaModel: 'paymentReceipt',
    dbTable: 'payment_receipts',
    label: 'Payment Receipts',
    pk: ['receipt_no'],
  },
  {
    prismaModel: 'expenseCategory',
    dbTable: 'expense_categories',
    label: 'Expense Categories',
    pk: ['category_id'],
  },
  { prismaModel: 'expense', dbTable: 'expenses', label: 'Expenses', pk: ['expense_id'] },
];

const BY_DB_TABLE = new Map(TABLE_REGISTRY.map((e) => [e.dbTable, e]));

/** Look up a registry entry by its public (URL-facing) dbTable name. Returns undefined if not allowlisted. */
export function getTableEntry(dbTable: string): TableRegistryEntry | undefined {
  return BY_DB_TABLE.get(dbTable);
}
