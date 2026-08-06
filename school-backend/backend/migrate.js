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
    // NOTE: each migration file manages its own BEGIN/COMMIT (or a DO $$
    // block) internally, so it's atomic on its own. We deliberately do NOT
    // wrap the whole batch in one more outer transaction here — Postgres
    // doesn't support nested transactions, so a previous version of this
    // function opened an outer BEGIN and then let each file's own COMMIT
    // silently commit everything run so far, not just that file. That
    // meant a later file failing wouldn't roll back earlier ones despite
    // the code implying otherwise. Running files sequentially without an
    // outer wrapper is honest about what actually happens: each file
    // either fully applies or fully rolls back on its own, and if one
    // fails, files before it in this run stay applied (they already
    // succeeded) while it and anything after stop.
    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, 'utf8').trim();
      if (!sql) continue;
      console.log(`Running migration: ${file}`);
      await client.query(sql);
    }

    console.log('✅ Migrations applied successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    console.error('   Migrations that ran before this one (if any) have already been committed individually.');
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
