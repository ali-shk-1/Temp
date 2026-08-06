/**
 * create-principal.js — creates (or resets) the "principal" login account.
 *
 * The principal role is scoped to fee management only: recording,
 * editing, and deleting fee payments — the same fee rights admin has.
 * It does NOT get admin's other rights (staff, students, expense
 * categories, or managing other user accounts). This is enforced in
 * routes/fees.js via authorize('admin', 'principal') / authorize('admin', 'principal').
 *
 * Usage:
 *   node create-principal.js                        -> username: principal, password: Principal@123
 *   node create-principal.js headmaster MySecurePass -> custom username + password
 *
 * Safe to re-run: if the username already exists, it just resets the
 * password and makes sure the role/active status are correct.
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('./db');

async function run() {
  const username = process.argv[2] || 'principal';
  const password = process.argv[3] || 'Principal@123';

  if (password.length < 6) {
    console.error('❌  Password must be at least 6 characters.');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Make sure the 'principal' role exists (no-op if migration 003 / seed.js already ran).
    await client.query(
      `INSERT INTO roles (role_name) VALUES ('principal') ON CONFLICT (role_name) DO NOTHING`
    );
    const roleRes = await client.query(`SELECT role_id FROM roles WHERE role_name = 'principal'`);
    const role_id = roleRes.rows[0].role_id;

    const hash = await bcrypt.hash(password, 12);

    const existing = await client.query('SELECT user_id FROM users WHERE username = $1', [username]);

    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE users SET password_hash = $1, role_id = $2, is_active = true WHERE username = $3`,
        [hash, role_id, username]
      );
      console.log(`✅  User "${username}" now has the principal role, with the new password.`);
    } else {
      await client.query(
        `INSERT INTO users (username, password_hash, role_id) VALUES ($1, $2, $3)`,
        [username, hash, role_id]
      );
      console.log(`✅  Principal account created  →  username: "${username}"  password: "${password}"`);
    }

    await client.query('COMMIT');
    console.log('⚠️   Change this password after first login via POST /api/auth/change-password.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  Failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();