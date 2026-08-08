const router = require('express').Router();
const pool   = require('../db');
const { authenticate, authorize, can } = require('../middleware/authMiddleware');
const { broadcast } = require('../sse');

router.use(authenticate);

/* ─────────────────────────────────────────
   LEFT STAFF (must come before /:id routes below so 'left' isn't
   swallowed as an :id param — same ordering pattern used in students.js)
───────────────────────────────────────── */

// GET /api/staff/left
router.get('/left', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM left_staff ORDER BY left_date DESC, name`
    );
    res.json({ count: rows.length, former_staff: rows });
  } catch (err) { next(err); }
});

// POST /api/staff/:id/leave
router.post('/:id/leave', can('staff.leave'), async (req, res, next) => {
  try {
    const { left_reason } = req.body;

    const { rows: staffRows } = await pool.query(
      `SELECT s.*, d.title AS designation_title
       FROM staff s
       LEFT JOIN designations d ON d.id = s.designation_id
       WHERE s.staff_id = $1`,
      [req.params.id]
    );
    if (staffRows.length === 0) return res.status(404).json({ error: 'Staff member not found.' });

    const staff = staffRows[0];

    // Unlike students, leaving staff does NOT delete any related records —
    // just moves the row to left_staff and removes them from the active
    // staff table. designation/designation_title are snapshotted onto the
    // left_staff row itself so history is preserved even if the
    // designation is later renamed or deleted.
    const { rows } = await pool.query(
      `INSERT INTO left_staff
         (old_staff_id, name, cnic, phone_no, salary, designation_id, designation, left_date, left_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [staff.staff_id, staff.name, staff.cnic, staff.phone_no, staff.salary,
       staff.designation_id, staff.designation_title,
       new Date().toISOString().slice(0, 10), left_reason || null]
    );

    await pool.query('DELETE FROM staff WHERE staff_id = $1', [req.params.id]);

    res.json({ message: 'Staff member moved to left_staff.', left_staff: rows[0] });
    broadcast('staff.changed', { action: 'left', staff_id: req.params.id });
    broadcast('left-staff.changed', { action: 'added', left_staff_id: rows[0].left_staff_id });
  } catch (err) { next(err); }
});

// PUT /api/staff/left/:id
router.put('/left/:id', can('left-staff.edit'), async (req, res, next) => {
  try {
    const { name, cnic, phone_no, salary, designation_id, designation, left_date, left_reason } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required.' });

    const { rows } = await pool.query(
      `UPDATE left_staff SET
         name=$1, cnic=$2, phone_no=$3, salary=$4,
         designation_id=$5, designation=$6, left_date=COALESCE($7, left_date), left_reason=$8
       WHERE left_staff_id=$9
       RETURNING *`,
      [name, cnic || null, phone_no || null, salary || null,
       designation_id || null, designation || null, left_date || null, left_reason || null,
       req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Left staff record not found.' });
    res.json({ message: 'Left staff record updated.', left_staff: rows[0] });
    broadcast('left-staff.changed', { action: 'updated', left_staff_id: rows[0].left_staff_id });
  } catch (err) { next(err); }
});

// DELETE /api/staff/left/:id
router.delete('/left/:id', can('left-staff.delete'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM left_staff WHERE left_staff_id = $1 RETURNING left_staff_id, name',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Left staff record not found.' });
    res.json({ message: 'Left staff record deleted.', left_staff: rows[0] });
    broadcast('left-staff.changed', { action: 'deleted', left_staff_id: req.params.id });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   DESIGNATIONS (nested resource)
───────────────────────────────────────── */

// GET /api/staff/designations
router.get('/designations', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM designations ORDER BY title');
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/staff/designations
router.post('/designations', can('staff.designations'), async (req, res, next) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required.' });

    const { rows } = await pool.query(
      'INSERT INTO designations (title) VALUES ($1) RETURNING *',
      [title]
    );
    res.status(201).json(rows[0]);
    broadcast('designations.changed', { action: 'added', id: rows[0].id });
  } catch (err) { next(err); }
});

// DELETE /api/staff/designations/:id
router.delete('/designations/:id', can('staff.designations'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM designations WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Designation not found.' });
    res.json({ message: 'Designation deleted.' });
    broadcast('designations.changed', { action: 'deleted', id: req.params.id });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   STAFF CRUD
───────────────────────────────────────── */

// GET /api/staff  — optional ?designation_id=
router.get('/', async (req, res, next) => {
  try {
    const { designation_id, search } = req.query;
    let query = `
      SELECT s.*, d.title AS designation_title
      FROM staff s
      LEFT JOIN designations d ON d.id = s.designation_id
      WHERE 1=1`;
    const vals = [];
    let idx = 1;

    if (designation_id) {
      query += ` AND s.designation_id = $${idx++}`;
      vals.push(designation_id);
    }
    if (search) {
      query += ` AND (LOWER(s.name) LIKE $${idx} OR s.cnic LIKE $${idx})`;
      vals.push(`%${search.toLowerCase()}%`);
      idx++;
    }

    query += ' ORDER BY s.name';
    const { rows } = await pool.query(query, vals);
    res.json({ count: rows.length, staff: rows });
  } catch (err) { next(err); }
});

// GET /api/staff/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, d.title AS designation_title
       FROM staff s
       LEFT JOIN designations d ON d.id = s.designation_id
       WHERE s.staff_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Staff member not found.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// POST /api/staff
router.post('/', can('staff.add'), async (req, res, next) => {
  try {
    const { name, cnic, phone_no, salary, designation_id } = req.body;

    if (!name || !cnic) {
      return res.status(400).json({ error: 'name and cnic are required.' });
    }

    let rows;
    try {
      ({ rows } = await pool.query(
        `INSERT INTO staff (name, cnic, phone_no, salary, designation_id)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [name, cnic, phone_no || null, salary || null, designation_id || null]
      ));
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'staff_cnic_unique') {
        return res.status(409).json({ error: 'A staff member with this CNIC already exists.' });
      }
      throw err;
    }
    res.status(201).json({ message: 'Staff member added.', staff: rows[0] });
    broadcast('staff.changed', { action: 'added', staff_id: rows[0].staff_id });
  } catch (err) { next(err); }
});

// PUT /api/staff/:id
router.put('/:id', can('staff.edit'), async (req, res, next) => {
  try {
    const { name, cnic, phone_no, salary, designation_id } = req.body;

    if (!name || !cnic) {
      return res.status(400).json({ error: 'name and cnic are required.' });
    }

    let rows;
    try {
      ({ rows } = await pool.query(
        `UPDATE staff SET name=$1, cnic=$2,
           phone_no=$3, salary=$4, designation_id=$5
         WHERE staff_id=$6
         RETURNING *`,
        [name, cnic, phone_no || null, salary || null, designation_id || null, req.params.id]
      ));
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'staff_cnic_unique') {
        return res.status(409).json({ error: 'A staff member with this CNIC already exists.' });
      }
      throw err;
    }
    if (rows.length === 0) return res.status(404).json({ error: 'Staff member not found.' });
    res.json({ message: 'Staff member updated.', staff: rows[0] });
    broadcast('staff.changed', { action: 'updated', staff_id: rows[0].staff_id });
  } catch (err) { next(err); }
});

// DELETE /api/staff/:id — gated by can('staff.delete'), which defaults
// to admin-only but is toggleable per-role by ali from the Permissions
// page (see permissions.js DEFAULT_PERMISSIONS).
router.delete('/:id', can('staff.delete'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM staff WHERE staff_id = $1 RETURNING staff_id, name',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Staff member not found.' });
    res.json({ message: 'Staff member deleted.', staff: rows[0] });
    broadcast('staff.changed', { action: 'deleted', staff_id: rows[0].staff_id });
  } catch (err) { next(err); }
});

module.exports = router;