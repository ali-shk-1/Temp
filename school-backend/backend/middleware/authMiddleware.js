const jwt = require('jsonwebtoken');
const pool = require('../db');
const { isAli, defaultsForRole } = require('../permissions');

/**
 * Verifies JWT token on every protected route.
 * Attaches decoded payload to req.user.
 */
const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  // Normal path: Authorization: Bearer <token> header (used by every
  // regular fetch/XHR call via api.js).
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && typeof req.query.token === 'string' && req.query.token) {
    // Fallback for EventSource (GET /api/events?token=...), which cannot
    // set custom request headers. Only relevant for that one route in
    // practice, but kept generic here rather than special-cased so any
    // future browser API with the same limitation can reuse it.
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'No token provided. Access denied.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { user_id, username, role }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired. Please log in again.' });
    }
    return res.status(403).json({ error: 'Invalid token.' });
  }
};

/**
 * Role-based access: pass one or more allowed roles.
 * Usage: authorize('admin')  |  authorize('admin', 'principal')  |  authorize('principal')
 */
const authorize = (...roles) => {
  const normalizedRoles = roles.map(r => String(r).toLowerCase());
  return (req, res, next) => {
    const userRole = req.user && req.user.role ? String(req.user.role).toLowerCase() : null;
    if (!userRole || !normalizedRoles.includes(userRole)) {
      return res.status(403).json({
        error: `Access denied. Required role(s): ${roles.join(', ')}.`,
      });
    }
    next();
  };
};

/**
 * Granular, DB-backed permission check.
 * Usage: can('students.add')  |  can('fees.delete')
 *
 * - 'ali' always passes, unconditionally, for every permission key.
 * - For admin/principal/viewer, looks up role_permissions; if no row
 *   exists yet (e.g. migration 008 hasn't been run), falls back to the
 *   hardcoded defaults in permissions.js so nothing breaks.
 */
const can = (permissionKey) => {
  return async (req, res, next) => {
    try {
      const role = req.user && req.user.role ? String(req.user.role).toLowerCase() : null;
      if (!role) {
        return res.status(403).json({ error: 'Access denied.' });
      }
      if (isAli(role)) return next();

      const { rows } = await pool.query(
        'SELECT allowed FROM role_permissions WHERE role_name = $1 AND permission_key = $2',
        [role, permissionKey]
      );

      let allowed;
      if (rows.length > 0) {
        allowed = rows[0].allowed;
      } else {
        const defaults = defaultsForRole(role);
        allowed = !!defaults[permissionKey];
      }

      if (!allowed) {
        return res.status(403).json({ error: `Access denied. You don't have permission to do this (${permissionKey}).` });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
};

module.exports = { authenticate, authorize, can };
