/**
 * scripts/create-ali-viewer.js — creates (or resets) the "ali" and "viewer"
 * login accounts, and makes sure the role_permissions defaults exist.
 *
 * ali    -> username: ali,    password: 123#Ali123   (top of hierarchy, all permissions, manages the Permissions page)
 * viewer -> username: viewer, password: Viewer@123   (read-only, no permissions by default)
 *
 * Safe to re-run: if a username already exists, it just resets the
 * password and makes sure the role/active status are correct. It will
 * NOT overwrite permission toggles ali has already changed (skipIfExists
 * pattern below, same as the original's ON CONFLICT DO NOTHING), so
 * re-running this script is safe even after ali has customized
 * permissions.
 *
 * Usage:
 *   node scripts/create-ali-viewer.js
 *
 * Rewritten from the original backend/create-ali-viewer.js to use
 * @prisma/client instead of raw pg. The role_permissions table is a
 * first-class Prisma model already (see prisma/schema.prisma ->
 * RolePermission) so the original's `CREATE TABLE IF NOT EXISTS
 * role_permissions (...)` step is not needed here — the table is created
 * by the Prisma migration instead.
 *
 * NOTE: DEFAULT_PERMISSIONS below is a plain-JS mirror of
 * lib/permissions.ts's DEFAULT_PERMISSIONS (only the 'viewer', 'admin',
 * and 'principal' entries are needed here, matching what the original
 * script seeded). Kept as a local copy rather than importing the
 * TypeScript module directly, since this script runs under plain
 * `node` (no ts-node/tsx in this project) — if lib/permissions.ts's
 * defaults for these three roles ever change, mirror the change here too.
 */

const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DEFAULT_PERMISSIONS = {
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

async function ensureRole(tx, roleName) {
  const role = await tx.role.upsert({
    where: { role_name: roleName },
    update: {},
    create: { role_name: roleName },
  });
  return role.role_id;
}

async function ensureUser(tx, username, password, roleId) {
  const hash = await bcrypt.hash(password, 12);
  const existing = await tx.user.findUnique({ where: { username } });

  if (existing) {
    await tx.user.update({
      where: { username },
      data: { password_hash: hash, role_id: roleId, is_active: true },
    });
    console.log(`✅  User "${username}" updated (role set, password reset).`);
  } else {
    await tx.user.create({
      data: { username, password_hash: hash, role_id: roleId },
    });
    console.log(`✅  User "${username}" created  →  password: "${password}"`);
  }
}

async function ensureDefaultPermissions(tx, roleName) {
  const defaults = DEFAULT_PERMISSIONS[roleName];
  if (!defaults) return;
  for (const [key, allowed] of Object.entries(defaults)) {
    const existing = await tx.rolePermission.findUnique({
      where: { role_name_permission_key: { role_name: roleName, permission_key: key } },
    });
    if (!existing) {
      await tx.rolePermission.create({
        data: { role_name: roleName, permission_key: key, allowed },
      });
    }
  }
}

async function run() {
  try {
    await prisma.$transaction(
      async (tx) => {
        const aliRoleId = await ensureRole(tx, 'ali');
        const viewerRoleId = await ensureRole(tx, 'viewer');

        await ensureUser(tx, 'ali', '123#Ali123', aliRoleId);
        await ensureUser(tx, 'viewer', 'Viewer@123', viewerRoleId);

        // ali has no row in role_permissions by design (always all-true in code).
        await ensureDefaultPermissions(tx, 'viewer');
        // Also make sure admin/principal defaults exist in case they
        // haven't been seeded yet — harmless no-op if they already exist.
        await ensureDefaultPermissions(tx, 'admin');
        await ensureDefaultPermissions(tx, 'principal');
      },
      { timeout: 20000 }
    );

    console.log(
      '⚠️   Change these passwords after first login via POST /api/auth/change-password, or ali can change them from the Permissions page.'
    );
  } catch (err) {
    console.error('❌  Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

run();
