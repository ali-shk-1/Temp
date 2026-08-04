const router = require('express').Router();
const pool   = require('../db');
const { authenticate, authorize } = require('../middleware/authMiddleware');

router.use(authenticate);

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
router.post('/designations', authorize('admin'), async (req, res, next) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required.' });

    const { rows } = await pool.query(
      'INSERT INTO designations (title) VALUES ($1) RETURNING *',
      [title]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/staff/designations/:id
router.delete('/designations/:id', authorize('admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM designations WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Designation not found.' });
    res.json({ message: 'Designation deleted.' });
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
      SELECT s.*, d.title AS designation
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
      query += ` AND (LOWER(s.name) LIKE $${idx} OR s.staff_code LIKE $${idx} OR s.cnic LIKE $${idx})`;
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
      `SELECT s.*, d.title AS designation
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
router.post('/', authorize('admin'), async (req, res, next) => {
  try {
    const { name, staff_code, cnic, phone_no, salary, designation_id } = req.body;

    if (!name || !staff_code || !cnic) {
      return res.status(400).json({ error: 'name, staff_code, and cnic are required.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO staff (name, staff_code, cnic, phone_no, salary, designation_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [name, staff_code, cnic, phone_no || null, salary || null, designation_id || null]
    );
    res.status(201).json({ message: 'Staff member added.', staff: rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/staff/:id
router.put('/:id', authorize('admin'), async (req, res, next) => {
  try {
    const { name, staff_code, cnic, phone_no, salary, designation_id } = req.body;

    if (!name || !staff_code || !cnic) {
      return res.status(400).json({ error: 'name, staff_code, and cnic are required.' });
    }

    const { rows } = await pool.query(
      `UPDATE staff SET name=$1, staff_code=$2, cnic=$3,
         phone_no=$4, salary=$5, designation_id=$6
       WHERE staff_id=$7
       RETURNING *`,
      [name, staff_code, cnic, phone_no || null, salary || null, designation_id || null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Staff member not found.' });
    res.json({ message: 'Staff member updated.', staff: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/staff/:id  — admin only
router.delete('/:id', authorize('admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM staff WHERE staff_id = $1 RETURNING staff_id, name',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Staff member not found.' });
    res.json({ message: 'Staff member deleted.', staff: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
