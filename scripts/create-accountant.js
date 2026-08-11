/**
 * scripts/create-accountant.js — creates (or resets) the "accountant" login account.
 *
 * Accountant's actual permissions are granular and DB-backed (see
 * lib/permissions.ts and the role_permissions table). By default accountant
 * gets full rights over money-related pages (fees, receipts, expenses,
 * tracking) but NOT student or staff record rights. Every one of those
 * defaults is individually toggleable by ali from the Permissions page,
 * so the real source of truth for what accountant can currently do is
 * the role_permissions table (or DEFAULT_PERMISSIONS.accountant in
 * lib/permissions.ts if no row has been set yet), not this comment.
 *
 * Usage:
 *   node scripts/create-accountant.js                  -> username: accountant, password: Acc@123
 *   node scripts/create-accountant.js myuser MyPass123  -> custom username + password
 *
 * Safe to re-run: if the username already exists, it just resets the
 * password and makes sure the role/active status are correct.
 *
 * Rewritten from the original backend/create-accountant.js to use
 * @prisma/client instead of raw pg — same behavior, same transaction
 * semantics, same log lines.
 */

const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function run() {
  const username = process.argv[2] || 'accountant';
  const password = process.argv[3] || 'Acc@123';

  if (password.length < 6) {
    console.error('❌  Password must be at least 6 characters.');
    process.exitCode = 1;
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Make sure the 'accountant' role exists (no-op if it already exists).
      const role = await tx.role.upsert({
        where: { role_name: 'accountant' },
        update: {},
        create: { role_name: 'accountant' },
      });

      const hash = await bcrypt.hash(password, 12);

      const existing = await tx.user.findUnique({ where: { username } });

      if (existing) {
        await tx.user.update({
          where: { username },
          data: { password_hash: hash, role_id: role.role_id, is_active: true },
        });
        console.log(`✅  User "${username}" now has the accountant role, with the new password.`);
      } else {
        await tx.user.create({
          data: { username, password_hash: hash, role_id: role.role_id },
        });
        console.log(`✅  Accountant account created  →  username: "${username}"  password: "${password}"`);
      }
    });

    console.log('⚠️   Change this password after first login via POST /api/auth/change-password.');
  } catch (err) {
    console.error('❌  Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

run();
