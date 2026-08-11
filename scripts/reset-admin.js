/**
 * scripts/reset-admin.js — resets the "admin" account's password back to
 * the default and makes sure it's active.
 *
 * Usage:
 *   node scripts/reset-admin.js
 *
 * Rewritten from the original backend/reset-admin.js to use
 * @prisma/client instead of raw pg — same behavior, same output.
 */

const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

(async () => {
  const password = 'Admin@123';
  const hash = await bcrypt.hash(password, 12);

  const result = await prisma.user.update({
    where: { username: 'admin' },
    data: { password_hash: hash, is_active: true },
    select: { user_id: true, username: true, is_active: true },
  });

  console.log(JSON.stringify(result));
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
