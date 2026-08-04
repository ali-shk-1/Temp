const bcrypt = require('bcrypt');
const pool = require('./db');

(async () => {
  const password = 'Admin@123';
  const hash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    'UPDATE users SET password_hash = $1, is_active = true WHERE username = $2 RETURNING user_id, username, is_active',
    [hash, 'admin']
  );

  console.log(JSON.stringify(result.rows[0]));
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
