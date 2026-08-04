/**
 * seed.js — Run ONCE to populate roles and create the first admin account.
 *
 * Usage:
 *   node seed.js
 *
 * Reads DB credentials from .env
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const pool   = require('./db');

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    /* ── Roles ─────────────────────────────── */
    console.log('Seeding roles...');
    await client.query(`
      INSERT INTO roles (role_name) VALUES
        ('admin'),
        ('principal')
        
      ON CONFLICT (role_name) DO NOTHING
    `);

    /* ── Default Designations ──────────────── */
    console.log('Seeding designations...');
    await client.query(`
      INSERT INTO designations (title) VALUES
        ('Principal'),
        ('Vice Principal'),
        ('Teacher'),
        ('Peon'),
        ('Guard')
      ON CONFLICT DO NOTHING
    `);

    /* ── Default Expense Categories ────────── */
    console.log('Seeding expense categories...');
    await client.query(`
      INSERT INTO expense_categories (category_name) VALUES
        ('Utilities'),
        ('Salaries'),
        ('Stationery'),
        ('Maintenance'),
        ('Events'),
        ('Miscellaneous')
      ON CONFLICT DO NOTHING
    `);

    /* ── First Admin Account ───────────────── */
    const adminUsername = 'admin';
    const adminPassword = 'Admin@123';   // ⚠️  Change immediately after first login

    const existing = await client.query(
      'SELECT user_id FROM users WHERE username = $1', [adminUsername]
    );

    if (existing.rows.length === 0) {
      const hash = await bcrypt.hash(adminPassword, 12);
      const roleRes = await client.query(
        "SELECT role_id FROM roles WHERE role_name = 'admin'"
      );
      const role_id = roleRes.rows[0].role_id;

      await client.query(
        `INSERT INTO users (username, password_hash, role_id)
         VALUES ($1, $2, $3)`,
        [adminUsername, hash, role_id]
      );
      console.log(`✅  Admin account created  →  username: "${adminUsername}"  password: "${adminPassword}"`);
      console.log('⚠️   CHANGE THIS PASSWORD IMMEDIATELY after first login.');
    } else {
      console.log('ℹ️   Admin account already exists. Skipping.');
    }

    await client.query('COMMIT');
    console.log('✅  Seed complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  Seed failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();