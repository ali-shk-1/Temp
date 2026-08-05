require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, 'utf8').trim();
      if (!sql) continue;
      console.log(`Running migration: ${file}`);
      await client.query(sql);
    }

    await client.query('COMMIT');
    console.log('✅ Migrations applied successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
