/**
 * create-ali-viewer.js — creates (or resets) the "ali" and "viewer" login
 * accounts, and makes sure the role_permissions defaults exist.
 *
 * ali    -> username: ali,    password: 123#Ali123   (top of hierarchy, all permissions, manages the Permissions page)
 * viewer -> username: viewer, password: Viewer@123   (read-only, no permissions by default)
 *
 * Safe to re-run: if a username already exists, it just resets the
 * password and makes sure the role/active status are correct. It will
 * NOT overwrite permission toggles ali has already changed (ON CONFLICT
 * DO NOTHING), so re-running this script is safe even after ali has
 * customized permissions.
 *
 * Usage:
 *   node create-ali-viewer.js
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('./db');
const { DEFAULT_PERMISSIONS } = require('./permissions');

async function ensureRole(client, roleName) {
  await client.query(`INSERT INTO roles (role_name) VALUES ($1) ON CONFLICT (role_name) DO NOTHING`, [roleName]);
  const res = await client.query(`SELECT role_id FROM roles WHERE role_name = $1`, [roleName]);
  return res.rows[0].role_id;
}

async function ensureUser(client, username, password, roleId) {
  const hash = await bcrypt.hash(password, 12);
  const existing = await client.query('SELECT user_id FROM users WHERE username = $1', [username]);

  if (existing.rows.length > 0) {
    await client.query(
      `UPDATE users SET password_hash = $1, role_id = $2, is_active = true WHERE username = $3`,
      [hash, roleId, username]
    );
    console.log(`✅  User "${username}" updated (role set, password reset).`);
  } else {
    await client.query(
      `INSERT INTO users (username, password_hash, role_id) VALUES ($1, $2, $3)`,
      [username, hash, roleId]
    );
    console.log(`✅  User "${username}" created  →  password: "${password}"`);
  }
}

async function ensureDefaultPermissions(client, roleName) {
  const defaults = DEFAULT_PERMISSIONS[roleName];
  if (!defaults) return;
  for (const [key, allowed] of Object.entries(defaults)) {
    await client.query(
      `INSERT INTO role_permissions (role_name, permission_key, allowed)
       VALUES ($1, $2, $3)
       ON CONFLICT (role_name, permission_key) DO NOTHING`,
      [roleName, key, allowed]
    );
  }
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_name       VARCHAR NOT NULL,
        permission_key  VARCHAR NOT NULL,
        allowed         BOOLEAN NOT NULL DEFAULT false,
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (role_name, permission_key)
      )
    `);

    const aliRoleId = await ensureRole(client, 'ali');
    const viewerRoleId = await ensureRole(client, 'viewer');

    await ensureUser(client, 'ali', '123#Ali123', aliRoleId);
    await ensureUser(client, 'viewer', 'Viewer@123', viewerRoleId);

    // ali has no row in role_permissions by design (always all-true in code).
    await ensureDefaultPermissions(client, 'viewer');
    // Also make sure admin/principal defaults exist in case migration 008
    // hasn't been run yet — harmless no-op if they already exist.
    await ensureDefaultPermissions(client, 'admin');
    await ensureDefaultPermissions(client, 'principal');

    await client.query('COMMIT');
    console.log('⚠️   Change these passwords after first login via POST /api/auth/change-password, or ali can change them from the Permissions page.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  Failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
