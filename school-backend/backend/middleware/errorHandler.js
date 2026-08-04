/**
 * Centralised error handler — mount LAST in server.js.
 * Catches anything passed via next(err).
 */
const errorHandler = (err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} →`, err);

  // PostgreSQL unique-violation
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Duplicate entry. Record already exists.' });
  }

  // PostgreSQL foreign-key violation
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referenced record does not exist.' });
  }

  // PostgreSQL not-null violation
  if (err.code === '23502') {
    return res.status(400).json({ error: `Required field missing: ${err.column}` });
  }

  // Default 500
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error.',
  });
};

module.exports = errorHandler;
