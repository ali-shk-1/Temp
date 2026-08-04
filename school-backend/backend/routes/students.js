const router = require('express').Router();
const pool   = require('../db');
const { authenticate, authorize } = require('../middleware/authMiddleware');

// All student routes require authentication
router.use(authenticate);

/* ─────────────────────────────────────────
   GET /api/students
   Query params: class, section, search (name/roll_no)
───────────────────────────────────────── */
router.get('/', async (req, res, next) => {
  try {
    const { class: cls, section, search } = req.query;

    let query  = `SELECT * FROM students WHERE 1=1`;
    const vals = [];
    let   idx  = 1;

    if (cls) {
      query += ` AND class = $${idx++}`;
      vals.push(cls);
    }
    if (section) {
      query += ` AND section = $${idx++}`;
      vals.push(section);
    }
    if (search) {
      query += ` AND (
        LOWER(first_name) LIKE $${idx}   OR
        LOWER(last_name)  LIKE $${idx}   OR
        CAST(roll_no AS TEXT) LIKE $${idx}
      )`;
      vals.push(`%${search.toLowerCase()}%`);
      idx++;
    }

    query += ` ORDER BY class, section, roll_no`;

    const { rows } = await pool.query(query, vals);
    res.json({ count: rows.length, students: rows });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────
   GET /api/students/:id
───────────────────────────────────────── */
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM students WHERE student_id = $1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Student not found.' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────
   POST /api/students
───────────────────────────────────────── */
router.post('/', authorize('admin', 'principal'), async (req, res, next) => {
  try {
    const { roll_no, section, class: cls, first_name, last_name,
            father_name, contact_1, contact_2, email, address, admission_date } = req.body;

    if (!roll_no || !section || !cls || !first_name || !last_name) {
      return res.status(400).json({
        error: 'roll_no, section, class, first_name, and last_name are required.',
      });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO students
         (roll_no, section, class, first_name, last_name,
          father_name, contact_1, contact_2, email, address, admission_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [roll_no, section, cls, first_name, last_name,
       father_name || null, contact_1 || null, contact_2 || null, email || null, address || null,
       admission_date || new Date().toISOString().slice(0, 10)]
    );

    res.status(201).json({ message: 'Student added.', student: rows[0] });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────
   PUT /api/students/:id
───────────────────────────────────────── */
router.put('/:id', authorize('principal'), async (req, res, next) => {
  try {
    const { roll_no, section, class: cls, first_name, last_name,
            father_name, contact_1, contact_2, email, address, admission_date } = req.body;

    if (!roll_no || !section || !cls || !first_name || !last_name) {
      return res.status(400).json({
        error: 'roll_no, section, class, first_name, and last_name are required.',
      });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    const { rows } = await pool.query(
      `UPDATE students SET
         roll_no=$1, section=$2, class=$3, first_name=$4, last_name=$5,
         father_name=$6, contact_1=$7, contact_2=$8, email=$9, address=$10,
         admission_date=COALESCE($11, admission_date)
       WHERE student_id=$12
       RETURNING *`,
      [roll_no, section, cls, first_name, last_name,
       father_name || null, contact_1 || null, contact_2 || null, email || null, address || null,
       admission_date || null, req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Student not found.' });
    res.json({ message: 'Student updated.', student: rows[0] });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────
   DELETE /api/students/:id  — principal only
   FIX: deletes fee_payments first inside a transaction so the FK
   constraint on fee_payments.student_id no longer blocks deletion.
───────────────────────────────────────── */
router.delete('/:id', authorize('principal'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM fee_payments WHERE student_id = $1', [req.params.id]);

    const { rows } = await client.query(
      'DELETE FROM students WHERE student_id = $1 RETURNING student_id, first_name, last_name',
      [req.params.id]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student not found.' });
    }

    await client.query('COMMIT');
    res.json({ message: 'Student deleted.', student: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/* ─────────────────────────────────────────
   GET /api/students/meta/classes
───────────────────────────────────────── */
router.get('/meta/classes', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT class, section
       FROM students
       ORDER BY class, section`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;