const router = require('express').Router();
const fs     = require('fs');
const path   = require('path');
const multer = require('multer');
const pool   = require('../db');
const { authenticate, authorize, can } = require('../middleware/authMiddleware');
const { broadcast } = require('../sse');

const allowedClasses = new Set([
  'playgroup', 'nursery', 'prep',
  '1','2','3','4','5','6','7','8','9','10'
]);

function normalizeMonthInput(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw.slice(0,7)}-01`;
  return null;
}

function getClassRollStart(normalizedClass) {
  return 1;
}

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const uniqueToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    cb(null, `${uniqueToken}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// All student routes require authentication
router.use(authenticate);

router.post('/upload-photo', can('students.add'), upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Photo file is required.' });
    }
    const url = `/uploads/${req.file.filename}`;
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

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
router.get('/left', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM left_students ORDER BY left_date DESC, roll_no`
    );
    res.json({ count: rows.length, former_students: rows });
  } catch (err) {
    next(err);
  }
});

// PUT /api/students/left/:id — full edit of a left-student record
router.put('/left/:id', can('left-students.edit'), async (req, res, next) => {
  try {
    const { roll_no, section, class: cls, first_name, last_name,
            father_name, contact_1, contact_2, email, photo_url, address,
            admission_date, fee_start_month, left_date, left_reason } = req.body;

    if (!first_name || !last_name) {
      return res.status(400).json({ error: 'first_name and last_name are required.' });
    }
    const rollNo = roll_no != null && roll_no !== '' ? parseInt(roll_no, 10) : null;
    if (rollNo != null && (!Number.isInteger(rollNo) || rollNo <= 0)) {
      return res.status(400).json({ error: 'Roll No must be a positive integer if provided.' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
    const normalizedFeeStart = normalizeMonthInput(fee_start_month);
    if (fee_start_month && !normalizedFeeStart) {
      return res.status(400).json({ error: 'fee_start_month must be in YYYY-MM format.' });
    }

    const { rows } = await pool.query(
      `UPDATE left_students SET
         roll_no=$1, section=$2, class=$3, first_name=$4, last_name=$5,
         father_name=$6, contact_1=$7, contact_2=$8, email=$9, photo_url=$10, address=$11,
         admission_date=$12, fee_start_month=$13, left_date=COALESCE($14, left_date), left_reason=$15
       WHERE left_student_id=$16
       RETURNING *`,
      [rollNo, section || null, cls || null, first_name, last_name,
       father_name || null, contact_1 || null, contact_2 || null, email || null, photo_url || null, address || null,
       admission_date || null, normalizedFeeStart || null, left_date || null, left_reason || null,
       req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Left student record not found.' });
    res.json({ message: 'Left student record updated.', former_student: rows[0] });
    broadcast('left-students.changed', { action: 'updated', left_student_id: rows[0].left_student_id });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/students/left/:id
router.delete('/left/:id', can('left-students.delete'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM left_students WHERE left_student_id = $1 RETURNING left_student_id, first_name, last_name, photo_url',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Left student record not found.' });

    const photoUrl = rows[0].photo_url;
    if (photoUrl && photoUrl.startsWith('/uploads/')) {
      const photoPath = path.join(uploadsDir, path.basename(photoUrl));
      fs.unlink(photoPath, (err) => {
        if (err && err.code !== 'ENOENT') {
          console.error('Failed to delete left-student photo:', photoPath, err.message);
        }
      });
    }

    res.json({ message: 'Left student record deleted.', former_student: rows[0] });
    broadcast('left-students.changed', { action: 'deleted', left_student_id: req.params.id });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/leave', can('students.leave'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { left_reason } = req.body;
    await client.query('BEGIN');

    const { rows: studentRows } = await client.query(
      'SELECT * FROM students WHERE student_id = $1',
      [req.params.id]
    );
    if (studentRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student not found.' });
    }

    const student = studentRows[0];

    const { rows: leftStudentRows } = await client.query(
      `INSERT INTO left_students
         (roll_no, section, class, first_name, last_name,
          father_name, contact_1, contact_2, email, photo_url, address,
          admission_date, fee_start_month, left_date, left_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING left_student_id`,
      [student.roll_no, student.section, student.class, student.first_name, student.last_name,
       student.father_name, student.contact_1, student.contact_2, student.email, student.photo_url,
       student.address, student.admission_date, student.fee_start_month || student.admission_date, new Date().toISOString().slice(0,10), left_reason || null]
    );
    const leftStudentId = leftStudentRows[0].left_student_id;

    // Preserve fee payment history instead of destroying it. This used to
    // be a straight DELETE with no snapshot — irreversible, and
    // inconsistent with staff.js's leave route, which preserves
    // everything by copying into left_staff. Copy each fee_payments row
    // into left_student_fee_payments first, then delete from the active
    // table, mirroring the pattern already used for the student row
    // itself (students -> left_students).
    await client.query(
      `INSERT INTO left_student_fee_payments
         (left_student_id, old_student_id, academic_month, amount_due, amount_paid, payment_date)
       SELECT $1, student_id, academic_month, amount_due, amount_paid, payment_date
       FROM fee_payments
       WHERE student_id = $2`,
      [leftStudentId, req.params.id]
    );

    await client.query('DELETE FROM fee_payments WHERE student_id = $1', [req.params.id]);
    await client.query('DELETE FROM students WHERE student_id = $1', [req.params.id]);

    await client.query('COMMIT');
    res.json({ message: 'Student moved to left_students.', student_id: req.params.id });
    broadcast('students.changed', { action: 'left', student_id: req.params.id });
    broadcast('left-students.changed', { action: 'added', student_id: req.params.id });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

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

/* ─────────────────────────────────────────
   POST /api/students
───────────────────────────────────────── */
router.post('/', can('students.add'), async (req, res, next) => {
  try {
    const { roll_no, section, class: cls, first_name, last_name,
            father_name, contact_1, contact_2, email, photo_url, address,
            admission_date, fee_start_month } = req.body;

    if (!section || !cls || !first_name || !last_name) {
      return res.status(400).json({
        error: 'section, class, first_name, and last_name are required.',
      });
    }
    const normalizedClass = String(cls).trim().toLowerCase();
    if (!allowedClasses.has(normalizedClass)) {
      return res.status(400).json({ error: 'Class must be one of playgroup, nursery, prep, or 1 through 10.' });
    }
    let explicitRollNo = roll_no != null && roll_no !== '' ? parseInt(roll_no, 10) : null;
    if (explicitRollNo != null && (!Number.isInteger(explicitRollNo) || explicitRollNo <= 0)) {
      return res.status(400).json({ error: 'Roll No must be a positive integer if provided.' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
    if (photo_url && !/^(?:https?:\/\/|\/uploads\/)/i.test(photo_url)) {
      return res.status(400).json({ error: 'Photo URL must begin with http://, https://, or /uploads or /uploads/.' });
    }
    const normalizedFeeStart = normalizeMonthInput(fee_start_month);
    if (fee_start_month && !normalizedFeeStart) {
      return res.status(400).json({ error: 'fee_start_month must be in YYYY-MM format.' });
    }

    // Roll numbers are assigned per-class. Since (class, roll_no) is now
    // enforced unique at the DB level, two concurrent inserts into the same
    // class can no longer silently collide — instead one of them will hit a
    // unique-violation (Postgres error code 23505), which we catch and
    // retry with a freshly recomputed roll number.
    const MAX_ATTEMPTS = 5;
    let lastErr;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let rollNo = explicitRollNo;
      if (rollNo == null) {
        const classStart = getClassRollStart(normalizedClass);
        const { rows: maxRow } = await pool.query(
          'SELECT MAX(roll_no) AS max_roll FROM students WHERE class = $1',
          [normalizedClass]
        );
        const maxRoll = maxRow[0]?.max_roll;
        rollNo = (maxRoll != null && maxRoll >= classStart) ? maxRoll + 1 : classStart;
      }

      try {
        const { rows } = await pool.query(
          `INSERT INTO students
             (roll_no, section, class, first_name, last_name,
              father_name, contact_1, contact_2, email, photo_url, address,
              admission_date, fee_start_month)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING *`,
          [rollNo, section, normalizedClass, first_name, last_name,
           father_name || null, contact_1 || null, contact_2 || null, email || null, photo_url || null, address || null,
           admission_date || new Date().toISOString().slice(0, 10), normalizedFeeStart || null]
        );

        res.status(201).json({ message: 'Student added.', student: rows[0] });
        broadcast('students.changed', { action: 'added', student_id: rows[0].student_id });
        return;
      } catch (err) {
        const isRollNoCollision = err.code === '23505' &&
          (err.constraint === 'students_class_roll_no_unique' || /roll_no/i.test(err.detail || ''));
        // Only auto-retry when we picked the roll number ourselves; if the
        // caller supplied an explicit roll_no, a collision is a real
        // conflict that should be reported, not silently reassigned.
        if (isRollNoCollision && explicitRollNo == null && attempt < MAX_ATTEMPTS - 1) {
          lastErr = err;
          continue;
        }
        if (isRollNoCollision && explicitRollNo != null) {
          return res.status(409).json({ error: 'That Roll No is already in use for this class.' });
        }
        throw err;
      }
    }
    throw lastErr;
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────
   PUT /api/students/:id
───────────────────────────────────────── */
router.put('/:id', can('students.edit'), async (req, res, next) => {
  try {
    const { roll_no, section, class: cls, first_name, last_name,
            father_name, contact_1, contact_2, email, photo_url, address,
            admission_date, fee_start_month } = req.body;

    if (!section || !cls || !first_name || !last_name) {
      return res.status(400).json({
        error: 'section, class, first_name, and last_name are required.',
      });
    }
    const normalizedClass = String(cls).trim().toLowerCase();
    if (!allowedClasses.has(normalizedClass)) {
      return res.status(400).json({ error: 'Class must be one of playgroup, nursery, prep, or 1 through 10.' });
    }
    const rollNo = roll_no != null && roll_no !== '' ? parseInt(roll_no, 10) : null;
    if (rollNo != null && (!Number.isInteger(rollNo) || rollNo <= 0)) {
      return res.status(400).json({ error: 'Roll No must be a positive integer if provided.' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
    if (photo_url && !/^(?:https?:\/\/|\/uploads\/)/i.test(photo_url)) {
      return res.status(400).json({ error: 'Photo URL must begin with http://, https://, or /uploads/.' });
    }
    const normalizedFeeStart = normalizeMonthInput(fee_start_month);
    if (fee_start_month && !normalizedFeeStart) {
      return res.status(400).json({ error: 'fee_start_month must be in YYYY-MM format.' });
    }

    let rows;
    try {
      ({ rows } = await pool.query(
        `UPDATE students SET
           roll_no=COALESCE($1, roll_no), section=$2, class=$3, first_name=$4, last_name=$5,
           father_name=$6, contact_1=$7, contact_2=$8, email=$9, photo_url=$10, address=$11,
           admission_date=COALESCE($12, admission_date),
           fee_start_month=COALESCE($13, fee_start_month)
         WHERE student_id=$14
         RETURNING *`,
        [rollNo, section, normalizedClass, first_name, last_name,
         father_name || null, contact_1 || null, contact_2 || null, email || null, photo_url || null, address || null,
         admission_date || null, normalizedFeeStart || null, req.params.id]
      ));
    } catch (err) {
      if (err.code === '23505' &&
          (err.constraint === 'students_class_roll_no_unique' || /roll_no/i.test(err.detail || ''))) {
        return res.status(409).json({ error: 'That Roll No is already in use for this class.' });
      }
      throw err;
    }

    if (rows.length === 0) return res.status(404).json({ error: 'Student not found.' });
    res.json({ message: 'Student updated.', student: rows[0] });
    broadcast('students.changed', { action: 'updated', student_id: rows[0].student_id });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────
   DELETE /api/students/:id — gated by can('students.delete'), which
   defaults to true for principal and false for admin, but either
   default is toggleable per-role by ali from the Permissions page (see
   permissions.js DEFAULT_PERMISSIONS). This is a permanent purge, distinct
   from POST /:id/leave below — deleting related fee_payments here is
   intentional (the student record itself is being erased), unlike the
   leave route, which now preserves fee history in
   left_student_fee_payments.
   FIX: deletes fee_payments first inside a transaction so the FK
   constraint on fee_payments.student_id no longer blocks deletion.
───────────────────────────────────────── */
router.delete('/:id', can('students.delete'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM fee_payments WHERE student_id = $1', [req.params.id]);

    const { rows } = await client.query(
      'DELETE FROM students WHERE student_id = $1 RETURNING student_id, first_name, last_name, photo_url',
      [req.params.id]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student not found.' });
    }

    await client.query('COMMIT');

    // Delete the student's photo file now that the DB delete is committed.
    // Only removes files served from our own /uploads folder — never touches
    // external http(s) photo_url values.
    const photoUrl = rows[0].photo_url;
    if (photoUrl && photoUrl.startsWith('/uploads/')) {
      const photoPath = path.join(uploadsDir, path.basename(photoUrl));
      fs.unlink(photoPath, (err) => {
        if (err && err.code !== 'ENOENT') {
          console.error('Failed to delete student photo:', photoPath, err.message);
        }
      });
    }

    res.json({ message: 'Student deleted.', student: rows[0] });
    broadcast('students.changed', { action: 'deleted', student_id: rows[0].student_id });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;