const router  = require('express').Router();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const pool    = require('../db');
const { authenticate, authorize } = require('../middleware/authMiddleware');

/* ─────────────────────────────────────────
   POST /api/auth/login
   Body: { username, password }
───────────────────────────────────────── */
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    // Fetch user with role name
    const { rows } = await pool.query(
      `SELECT u.user_id, u.username, u.password_hash, u.is_active,
              r.role_name AS role, u.staff_id
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       WHERE u.username = $1`,
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const user = rows[0];

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is disabled. Contact administrator.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    // Update last_login
    await pool.query(
      'UPDATE users SET last_login = NOW() WHERE user_id = $1',
      [user.user_id]
    );

    const token = jwt.sign(
      { user_id: user.user_id, username: user.username, role: user.role, staff_id: user.staff_id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      message: 'Login successful.',
      token,
      user: { user_id: user.user_id, username: user.username, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────
   GET /api/auth/me  — verify token + return profile
───────────────────────────────────────── */
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.user_id, u.username, r.role_name AS role,
              u.staff_id, u.last_login, u.created_at,
              s.name AS staff_name
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       LEFT JOIN staff s ON s.staff_id = u.staff_id
       WHERE u.user_id = $1`,
      [req.user.user_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────
   POST /api/auth/change-password
   Body: { current_password, new_password }
───────────────────────────────────────── */
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Both current and new password are required.' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }

    const { rows } = await pool.query(
      'SELECT password_hash FROM users WHERE user_id = $1',
      [req.user.user_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });

    const match = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });

    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE user_id = $2', [hash, req.user.user_id]);

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────
   POST /api/auth/register  — admin only
   Body: { username, password, role_id, staff_id? }
───────────────────────────────────────── */
router.post('/register', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { username, password, role_id, staff_id } = req.body;

    if (!username || !password || !role_id) {
      return res.status(400).json({ error: 'username, password, and role_id are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    // Block minting a second 'ali' account through this endpoint. ali is
    // the top of the hierarchy (always-all-permissions, manages every
    // other account, cannot itself be restricted) and is meant to exist
    // exactly once, provisioned only via create-ali-viewer.js. Without
    // this check, any admin could POST ali's role_id here and create a
    // second unrestricted account that bypasses the whole permissions
    // system.
    const { rows: roleRows } = await pool.query('SELECT role_name FROM roles WHERE role_id = $1', [role_id]);
    if (roleRows.length === 0) {
      return res.status(400).json({ error: 'Invalid role_id.' });
    }
    if (String(roleRows[0].role_name).toLowerCase() === 'ali') {
      return res.status(403).json({ error: 'The ali role cannot be assigned through registration.' });
    }

    const hash = await bcrypt.hash(password, 12);

    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, role_id, staff_id)
       VALUES ($1, $2, $3, $4)
       RETURNING user_id, username, role_id, staff_id, created_at`,
      [username, hash, role_id, staff_id || null]
    );

    res.status(201).json({ message: 'User created.', user: rows[0] });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────
   PATCH /api/auth/users/:id/toggle  — admin only
   Enable / disable a user account
───────────────────────────────────────── */
router.patch('/users/:id/toggle', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE users SET is_active = NOT is_active
       WHERE user_id = $1
       RETURNING user_id, username, is_active`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    res.json({ message: `Account ${rows[0].is_active ? 'enabled' : 'disabled'}.`, user: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
