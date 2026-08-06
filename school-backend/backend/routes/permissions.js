const router = require('express').Router();
const bcrypt = require('bcrypt');
const pool   = require('../db');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const { PERMISSION_GROUPS, PERMISSION_KEYS, MANAGEABLE_ROLES, isAli, defaultsForRole } = require('../permissions');
const { broadcast } = require('../sse');

/* ─────────────────────────────────────────
   GET /api/permissions/me  — any authenticated user
   Returns the calling user's own effective permission map. Used by the
   frontend (nav.js -> loadMyPermissions()) to decide which add/edit/
   delete buttons to show on every page. ali gets all-true, viewer gets
   all-false, admin/principal get whatever ali has toggled (or the
   hardcoded defaults if nothing has been toggled yet).
───────────────────────────────────────── */
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const role = req.user && req.user.role ? String(req.user.role).toLowerCase() : null;
    if (!role) return res.status(403).json({ error: 'Access denied.' });

    if (isAli(role) || !MANAGEABLE_ROLES.includes(role)) {
      // ali -> all true. Any other/unknown role (shouldn't normally
      // happen) -> safe default of all false.
      return res.json({ role, permissions: defaultsForRole(role) });
    }

    const { rows } = await pool.query(
      'SELECT permission_key, allowed FROM role_permissions WHERE role_name = $1',
      [role]
    );
    const defaults = defaultsForRole(role);
    const permissions = {};
    PERMISSION_KEYS.forEach(key => { permissions[key] = defaults[key]; });
    rows.forEach(r => { permissions[r.permission_key] = r.allowed; });

    res.json({ role, permissions });
  } catch (err) {
    next(err);
  }
});

// Everything below is ali-only. authorize('ali') keeps the same pattern
// used everywhere else in this codebase (authorize('admin'), etc).
router.use(authenticate, authorize('ali'));

/* ─────────────────────────────────────────
   GET /api/permissions
   Returns the full permission matrix for admin, principal, and viewer,
   plus the usernames currently holding each of those roles (so the
   Permissions page can show "Admin — admin", "Principal — principal",
   "Viewer — viewer", and let ali reset a password for any of them).
───────────────────────────────────────── */
router.get('/', async (req, res, next) => {
  try {
    const { rows: permRows } = await pool.query(
      'SELECT role_name, permission_key, allowed FROM role_permissions'
    );

    const { rows: userRows } = await pool.query(
      `SELECT u.user_id, u.username, u.is_active, r.role_name AS role
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       WHERE r.role_name = ANY($1::text[])
       ORDER BY r.role_name, u.username`,
      [MANAGEABLE_ROLES]
    );

    const result = MANAGEABLE_ROLES.map(role => {
      const defaults = defaultsForRole(role);
      const stored = {};
      permRows
        .filter(r => r.role_name === role)
        .forEach(r => { stored[r.permission_key] = r.allowed; });

      const permissions = {};
      PERMISSION_KEYS.forEach(key => {
        permissions[key] = Object.prototype.hasOwnProperty.call(stored, key)
          ? stored[key]
          : defaults[key];
      });

      return {
        role,
        users: userRows.filter(u => u.role === role),
        permissions,
      };
    });

    res.json({ groups: PERMISSION_GROUPS, roles: result });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────
   PUT /api/permissions/:role
   Body: { permission_key, allowed }
   Toggle a single permission for admin, principal, or viewer.
───────────────────────────────────────── */
router.put('/:role', async (req, res, next) => {
  try {
    const role = String(req.params.role || '').toLowerCase();
    const { permission_key, allowed } = req.body;

    if (!MANAGEABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${MANAGEABLE_ROLES.join(', ')}.` });
    }
    if (!PERMISSION_KEYS.includes(permission_key)) {
      return res.status(400).json({ error: 'Unknown permission_key.' });
    }
    if (typeof allowed !== 'boolean') {
      return res.status(400).json({ error: 'allowed must be true or false.' });
    }

    await pool.query(
      `INSERT INTO role_permissions (role_name, permission_key, allowed, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (role_name, permission_key)
       DO UPDATE SET allowed = EXCLUDED.allowed, updated_at = NOW()`,
      [role, permission_key, allowed]
    );

    res.json({ message: 'Permission updated.', role, permission_key, allowed });
    broadcast('permissions.changed', { role, permission_key, allowed });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────
   POST /api/permissions/users/:user_id/password
   Body: { new_password }
   ali resets the password for an admin/principal/viewer account.
───────────────────────────────────────── */
router.post('/users/:user_id/password', async (req, res, next) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'new_password is required and must be at least 6 characters.' });
    }

    const { rows: targetRows } = await pool.query(
      `SELECT u.user_id, u.username, r.role_name AS role
       FROM users u JOIN roles r ON r.role_id = u.role_id
       WHERE u.user_id = $1`,
      [req.params.user_id]
    );
    if (targetRows.length === 0) return res.status(404).json({ error: 'User not found.' });

    const target = targetRows[0];
    if (!MANAGEABLE_ROLES.includes(String(target.role).toLowerCase())) {
      return res.status(403).json({ error: 'Can only reset passwords for admin, principal, or viewer accounts.' });
    }

    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE user_id = $2', [hash, target.user_id]);

    res.json({ message: `Password updated for "${target.username}".` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
