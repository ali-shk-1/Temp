const router = require('express').Router();
const bcrypt = require('bcrypt');
const pool   = require('../db');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const { PERMISSION_GROUPS, PERMISSION_KEYS, PAGE_KEYS, MANAGEABLE_ROLES, isAli, defaultsForRole } = require('../permissions');
const { broadcast } = require('../sse');

/* ─────────────────────────────────────────
   GET /api/permissions/me  — any authenticated user
   Returns the calling user's own effective permission map plus which nav
   pages are visible for their role. Used by the frontend (nav.js) to
   decide which add/edit/delete buttons AND which whole nav links to show.
   ali gets all-true / all-visible, viewer gets all-false permissions (but
   still whatever page visibility ali set), admin/principal get whatever
   ali has toggled (or the hardcoded defaults if nothing's been toggled).
───────────────────────────────────────── */
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const role = req.user && req.user.role ? String(req.user.role).toLowerCase() : null;
    if (!role) return res.status(403).json({ error: 'Access denied.' });

    const page_visibility = {};
    PAGE_KEYS.forEach(p => { page_visibility[p.key] = true; });
    if (!isAli(role) && MANAGEABLE_ROLES.includes(role)) {
      const { rows: visRows } = await pool.query(
        'SELECT page_key, visible FROM role_page_visibility WHERE role_name = $1',
        [role]
      );
      visRows.forEach(v => { page_visibility[v.page_key] = v.visible; });
    }

    if (isAli(role) || !MANAGEABLE_ROLES.includes(role)) {
      // ali -> all true. Any other/unknown role (shouldn't normally
      // happen) -> safe default of all false.
      return res.json({ role, permissions: defaultsForRole(role), page_visibility });
    }

    const { rows } = await pool.query(
      'SELECT permission_key, allowed FROM role_permissions WHERE role_name = $1',
      [role]
    );
    const defaults = defaultsForRole(role);
    const permissions = {};
    PERMISSION_KEYS.forEach(key => { permissions[key] = defaults[key]; });
    rows.forEach(r => { permissions[r.permission_key] = r.allowed; });

    res.json({ role, permissions, page_visibility });
  } catch (err) {
    next(err);
  }
});

// Everything below is ali-only. authorize('ali') keeps the same pattern
// used everywhere else in this codebase (authorize('admin'), etc).
router.use(authenticate, authorize('ali'));

/* ─────────────────────────────────────────
   GET /api/permissions
   Returns the full permission matrix AND page-visibility matrix for
   admin, principal, and viewer, plus the username currently holding each
   role, so the Permissions page can show "Admin — admin", let ali rename
   the account or reset its password, and toggle both action permissions
   and whole-page nav visibility per role.
───────────────────────────────────────── */
router.get('/', async (req, res, next) => {
  try {
    const { rows: permRows } = await pool.query(
      'SELECT role_name, permission_key, allowed FROM role_permissions'
    );

    const { rows: visRows } = await pool.query(
      'SELECT role_name, page_key, visible FROM role_page_visibility'
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

      const visStored = {};
      visRows
        .filter(v => v.role_name === role)
        .forEach(v => { visStored[v.page_key] = v.visible; });
      const page_visibility = {};
      PAGE_KEYS.forEach(p => {
        page_visibility[p.key] = Object.prototype.hasOwnProperty.call(visStored, p.key)
          ? visStored[p.key]
          : true; // fail-open: no override row means visible
      });

      return {
        role,
        users: userRows.filter(u => u.role === role),
        permissions,
        page_visibility,
      };
    });

    res.json({ groups: PERMISSION_GROUPS, pages: PAGE_KEYS, roles: result });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────
   PUT /api/permissions/:role
   Body: { permission_key, allowed }
   Toggle a single action permission (add/edit/delete/etc.) for admin,
   principal, or viewer.
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
   PUT /api/permissions/:role/visibility
   Body: { page_key, visible }
   Toggle whether an entire nav page (e.g. "Staff") is shown at all for
   every account holding this role. Distinct from PUT /:role above,
   which toggles individual add/edit/delete actions — this hides the
   whole page/link instead.
───────────────────────────────────────── */
router.put('/:role/visibility', async (req, res, next) => {
  try {
    const role = String(req.params.role || '').toLowerCase();
    const { page_key, visible } = req.body;

    if (!MANAGEABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${MANAGEABLE_ROLES.join(', ')}.` });
    }
    if (!PAGE_KEYS.some(p => p.key === page_key)) {
      return res.status(400).json({ error: 'Unknown page_key.' });
    }
    if (typeof visible !== 'boolean') {
      return res.status(400).json({ error: 'visible must be true or false.' });
    }

    await pool.query(
      `INSERT INTO role_page_visibility (role_name, page_key, visible, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (role_name, page_key)
       DO UPDATE SET visible = EXCLUDED.visible, updated_at = NOW()`,
      [role, page_key, visible]
    );

    res.json({ message: 'Page visibility updated.', role, page_key, visible });
    broadcast('permissions.changed', { role, page_key, visible, action: 'visibility_updated' });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────
   POST /api/permissions/users/:role
   Body: { username, password }
   Creates the single login account for a manageable role (admin,
   principal, vice_principal, accountant, viewer) — each role has exactly
   one account, same 1:1 model as create-admin.js etc. Fails with 409 if
   that role already has an account; use rename/reset-password instead.
───────────────────────────────────────── */
router.post('/users/:role', async (req, res, next) => {
  try {
    const role = String(req.params.role || '').toLowerCase();
    const { username, password } = req.body;

    if (!MANAGEABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${MANAGEABLE_ROLES.join(', ')}.` });
    }
    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'username is required.' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'password is required and must be at least 6 characters.' });
    }

    const { rows: existingForRole } = await pool.query(
      `SELECT u.user_id FROM users u
       JOIN roles r ON r.role_id = u.role_id
       WHERE r.role_name = $1`,
      [role]
    );
    if (existingForRole.length > 0) {
      return res.status(409).json({ error: `An account already exists for the ${role} role. Rename or reset its password instead.` });
    }

    const { rows: dupe } = await pool.query('SELECT user_id FROM users WHERE username = $1', [username.trim()]);
    if (dupe.length > 0) return res.status(409).json({ error: `Username "${username}" is already taken.` });

    // Make sure the role exists (roles for vice_principal/accountant were
    // added by later migrations; no-op if it's already there).
    await pool.query(`INSERT INTO roles (role_name) VALUES ($1) ON CONFLICT (role_name) DO NOTHING`, [role]);
    const { rows: roleRows } = await pool.query('SELECT role_id FROM roles WHERE role_name = $1', [role]);
    const role_id = roleRows[0].role_id;

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, role_id, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING user_id, username, is_active`,
      [username.trim(), hash, role_id]
    );

    res.status(201).json({ message: 'Account created.', user: rows[0] });
    broadcast('permissions.changed', { action: 'user_created', role });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────
   PATCH /api/permissions/users/:user_id/toggle
   Enable/disable a role's account without deleting it — the account
   (and its role/permissions) is kept, just blocked from logging in.
   Mirrors PATCH /api/auth/users/:id/toggle, but scoped to the roles this
   page manages, and broadcasts permissions.changed instead of nothing
   so every open Permissions page updates live.
───────────────────────────────────────── */
router.patch('/users/:user_id/toggle', async (req, res, next) => {
  try {
    const { rows: targetRows } = await pool.query(
      `SELECT u.user_id, r.role_name AS role
       FROM users u JOIN roles r ON r.role_id = u.role_id
       WHERE u.user_id = $1`,
      [req.params.user_id]
    );
    if (targetRows.length === 0) return res.status(404).json({ error: 'User not found.' });
    if (!MANAGEABLE_ROLES.includes(String(targetRows[0].role).toLowerCase())) {
      return res.status(403).json({ error: 'Can only enable/disable admin, principal, vice_principal, accountant, or viewer accounts.' });
    }

    const { rows } = await pool.query(
      `UPDATE users SET is_active = NOT is_active
       WHERE user_id = $1
       RETURNING user_id, username, is_active`,
      [req.params.user_id]
    );

    res.json({ message: `Account ${rows[0].is_active ? 'enabled' : 'disabled'}.`, user: rows[0] });
    broadcast('permissions.changed', { action: 'user_toggled', user_id: rows[0].user_id, is_active: rows[0].is_active });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────
   PUT /api/permissions/users/:user_id
   Body: { username }
   ali renames an existing admin/principal/viewer account's username.
   Each manageable role corresponds to exactly one login account (created
   via create-principal.js / create-ali-viewer.js / seed.js), so this is
   a rename, not account creation — the role itself is the identity.
   Password changes go through POST /users/:user_id/password below.
───────────────────────────────────────── */
router.put('/users/:user_id', async (req, res, next) => {
  try {
    const { username } = req.body;
    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'username is required.' });
    }

    const { rows: targetRows } = await pool.query(
      `SELECT u.user_id, r.role_name AS role
       FROM users u JOIN roles r ON r.role_id = u.role_id
       WHERE u.user_id = $1`,
      [req.params.user_id]
    );
    if (targetRows.length === 0) return res.status(404).json({ error: 'User not found.' });
    if (!MANAGEABLE_ROLES.includes(String(targetRows[0].role).toLowerCase())) {
      return res.status(403).json({ error: 'Can only edit admin, principal, or viewer accounts.' });
    }

    const { rows: dupe } = await pool.query(
      'SELECT user_id FROM users WHERE username = $1 AND user_id != $2',
      [username.trim(), req.params.user_id]
    );
    if (dupe.length > 0) return res.status(409).json({ error: `Username "${username}" is already taken.` });

    const { rows } = await pool.query(
      `UPDATE users SET username = $1 WHERE user_id = $2
       RETURNING user_id, username, role_id, is_active`,
      [username.trim(), req.params.user_id]
    );

    res.json({ message: 'Username updated.', user: rows[0] });
    broadcast('permissions.changed', { action: 'user_updated', user_id: req.params.user_id });
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
