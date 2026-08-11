/**
 * scripts/seed.js — Run ONCE to populate roles and create the first admin account.
 *
 * Usage:
 *   node scripts/seed.js
 *
 * Reads DB credentials from DATABASE_URL (see prisma/schema.prisma).
 * Rewritten from the original backend/seed.js to use @prisma/client
 * instead of raw pg — same behavior, same ON CONFLICT DO NOTHING /
 * "already exists, skipping" semantics, same log lines.
 */

const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function seed() {
  await prisma.$transaction(async (tx) => {
    /* ── Roles ─────────────────────────────── */
    console.log('Seeding roles...');
    for (const role_name of ['admin', 'principal']) {
      await tx.role.upsert({
        where: { role_name },
        update: {},
        create: { role_name },
      });
    }

    /* ── Default Designations ──────────────── */
    console.log('Seeding designations...');
    for (const title of ['Principal', 'Vice Principal', 'Teacher', 'Peon', 'Guard']) {
      const existing = await tx.designation.findFirst({ where: { title } });
      if (!existing) {
        await tx.designation.create({ data: { title } });
      }
    }

    /* ── Default Expense Categories ────────── */
    console.log('Seeding expense categories...');
    for (const category_name of ['Utilities', 'Salaries', 'Stationery', 'Maintenance', 'Events', 'Miscellaneous']) {
      const existing = await tx.expenseCategory.findFirst({ where: { category_name } });
      if (!existing) {
        await tx.expenseCategory.create({ data: { category_name } });
      }
    }

    /* ── First Admin Account ───────────────── */
    const adminUsername = 'admin';
    const adminPassword = 'Admin@123'; // ⚠️  Change immediately after first login

    const existingAdmin = await tx.user.findUnique({ where: { username: adminUsername } });

    if (!existingAdmin) {
      const hash = await bcrypt.hash(adminPassword, 12);
      const adminRole = await tx.role.findUnique({ where: { role_name: 'admin' } });

      await tx.user.create({
        data: { username: adminUsername, password_hash: hash, role_id: adminRole.role_id },
      });
      console.log(`✅  Admin account created  →  username: "${adminUsername}"  password: "${adminPassword}"`);
      console.log('⚠️   CHANGE THIS PASSWORD IMMEDIATELY after first login.');
    } else {
      console.log('ℹ️   Admin account already exists. Skipping.');
    }

    /* ── Default Principal Account ───────── */
    const principalUsername = 'principal';
    const principalPassword = 'Principal@123';

    const existingPrincipal = await tx.user.findUnique({ where: { username: principalUsername } });

    if (!existingPrincipal) {
      const principalHash = await bcrypt.hash(principalPassword, 12);
      const principalRole = await tx.role.findUnique({ where: { role_name: 'principal' } });

      await tx.user.create({
        data: { username: principalUsername, password_hash: principalHash, role_id: principalRole.role_id },
      });
      console.log(`✅  Principal account created  →  username: "${principalUsername}"  password: "${principalPassword}"`);
      console.log('⚠️   CHANGE THIS PASSWORD IMMEDIATELY after first login.');
    } else {
      console.log('ℹ️   Principal account already exists. Skipping.');
    }
  });

  console.log('✅  Seed complete.');
}

seed()
  .catch((err) => {
    console.error('❌  Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
