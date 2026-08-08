/**
 * create-vice-principal.js — creates (or resets) the "vice_principal" login account.
 *
 * Vice Principal's actual permissions are granular and DB-backed (see
 * permissions.js and the role_permissions table). By default vice
 * principal gets the same starting permissions as principal (full
 * student rights, fee rights), but NOT staff or expense-category
 * rights. Every one of those defaults is individually toggleable by ali
 * from the Permissions page, so the real source of truth for what vice
 * principal can currently do is the role_permissions table (or
 * DEFAULT_PERMISSIONS.vice_principal in permissions.js if no row has
 * been set yet), not this comment.
 *
 * Usage:
 *   node create-vice-principal.js                  -> username: vp, password: Vp@123
 *   node create-vice-principal.js myuser MyPass123  -> custom username + password
 *
 * Safe to re-run: if the username already exists, it just resets the
 * password and makes sure the role/active status are correct.
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('./db');

async function run() {
  const username = process.argv[2] || 'vp';
  const password = process.argv[3] || 'Vp@123';

  if (password.length < 6) {
    console.error('❌  Password must be at least 6 characters.');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Make sure the 'vice_principal' role exists (no-op if migration 016 already ran).
    await client.query(
      `INSERT INTO roles (role_name) VALUES ('vice_principal') ON CONFLICT (role_name) DO NOTHING`
    );
    const roleRes = await client.query(`SELECT role_id FROM roles WHERE role_name = 'vice_principal'`);
    const role_id = roleRes.rows[0].role_id;

    const hash = await bcrypt.hash(password, 12);

    const existing = await client.query('SELECT user_id FROM users WHERE username = $1', [username]);

    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE users SET password_hash = $1, role_id = $2, is_active = true WHERE username = $3`,
        [hash, role_id, username]
      );
      console.log(`✅  User "${username}" now has the vice_principal role, with the new password.`);
    } else {
      await client.query(
        `INSERT INTO users (username, password_hash, role_id) VALUES ($1, $2, $3)`,
        [username, hash, role_id]
      );
      console.log(`✅  Vice Principal account created  →  username: "${username}"  password: "${password}"`);
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
