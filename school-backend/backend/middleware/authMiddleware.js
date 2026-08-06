const jwt = require('jsonwebtoken');

/**
 * Verifies JWT token on every protected route.
 * Attaches decoded payload to req.user.
 */
const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided. Access denied.' });
  }

  const token = authHeader.split(' ')[1];

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

module.exports = { authenticate, authorize };
