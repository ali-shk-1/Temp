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

  // PostgreSQL foreign-key violation — this code fires in BOTH directions:
  //   (a) insert/update pointing at a parent row that doesn't exist
  //       (e.g. PUT /expenses/:id with a bogus category_id, or PUT
  //       /staff/:id with a bogus designation_id), or
  //   (b) delete of a row that's still referenced by other rows (e.g.
  //       deleting a staff designation still assigned to staff, or an
  //       expense category still used by expenses) — the RESTRICT/NO
  //       ACTION default blocks it.
  // A single "Referenced record does not exist" message is actively
  // wrong for case (b): the record *does* exist and *is* referenced,
  // which is exactly why the operation was blocked. Every PUT/PATCH
  // route in this app only ever writes a foreign key column pointing
  // outward (never removes a parent row), so case (b) only ever happens
  // on DELETE here — that's the only method that gets the "still in
  // use" phrasing; everything else keeps the "missing parent" phrasing.
  if (err.code === '23503') {
    if (req.method === 'DELETE') {
      return res.status(409).json({ error: 'This record is still referenced by other data and cannot be removed. Update or remove those first.' });
    }
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
