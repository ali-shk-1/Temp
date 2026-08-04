const router = require('express').Router();
const pool   = require('../db');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const { sendMail } = require('../utils/mailer');

router.use(authenticate);

function normalizeMonthInput(value) {
  if (!value) return null;
  let raw = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}-01$/.test(raw)) {
    raw = raw.slice(0, -3);
  }

  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return raw;
}

router.post('/', authorize('admin', 'principal'), async (req, res, next) => {
  try {
    const { student_id, academic_month, amount_due, amount_paid } = req.body;
    if (!student_id || !academic_month || amount_due == null) {
      return res.status(400).json({ error: 'student_id, academic_month, and amount_due are required.' });
    }
    const studentCheck = await pool.query(
      'SELECT student_id FROM students WHERE student_id = $1', [student_id]
    );
    if (studentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO fee_payments (student_id, academic_month, amount_due, amount_paid)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [student_id, academic_month, amount_due, amount_paid || 0]
    );

    // Re-fetch joined with student info so the client has everything it
    // needs to render/print a receipt without a second round-trip.
    const receipt = await pool.query(
      `SELECT fp.*,
              (fp.amount_due - fp.amount_paid) AS balance,
              s.roll_no, s.first_name, s.last_name, s.class, s.section,
              s.father_name, s.contact_1, s.contact_2, s.address, s.email
       FROM fee_payments fp
       JOIN students s ON s.student_id = fp.student_id
       WHERE fp.payment_id = $1`,
      [rows[0].payment_id]
    );

    const payment = receipt.rows[0];
    if (payment && payment.email && Number(payment.amount_paid) > 0) {
      const formattedMonth = new Date(payment.academic_month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      const paymentDate = payment.payment_date
        ? new Date(payment.payment_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        : new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      const formatCurrency = value => new Intl.NumberFormat('en-PK', {
        style: 'currency', currency: 'PKR', minimumFractionDigits: 0,
      }).format(Number(value || 0));

      const subject = `Fee Payment Receipt — ${payment.first_name} ${payment.last_name}`;
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.5;">
          <h2 style="color:#2b6cb0;">Fee Payment Receipt</h2>
          <p>Dear ${payment.first_name} ${payment.last_name},</p>
          <p>Thank you for your fee payment. Below are the details for the payment recorded for <strong>${formattedMonth}</strong>:</p>
          <table style="width:100%;border-collapse:collapse;margin-top:16px;">
            <tr><td style="padding:8px;border:1px solid #ddd;">Student Name</td><td style="padding:8px;border:1px solid #ddd;">${payment.first_name} ${payment.last_name}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;">Roll No.</td><td style="padding:8px;border:1px solid #ddd;">${payment.roll_no}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;">Class / Section</td><td style="padding:8px;border:1px solid #ddd;">${payment.class} / ${payment.section}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;">Payment Date</td><td style="padding:8px;border:1px solid #ddd;">${paymentDate}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;">Amount Due</td><td style="padding:8px;border:1px solid #ddd;">${formatCurrency(payment.amount_due)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;">Amount Paid</td><td style="padding:8px;border:1px solid #ddd;">${formatCurrency(payment.amount_paid)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;">Balance</td><td style="padding:8px;border:1px solid #ddd;">${formatCurrency(payment.balance)}</td></tr>
          </table>
          <p style="margin-top:16px;">If you have any questions or need further assistance, please contact the school office.</p>
          <p style="margin-top:8px;">Sincerely,<br/>School Administration</p>
        </div>`;
      const text = `Fee Payment Receipt\n\nStudent: ${payment.first_name} ${payment.last_name}\nRoll No: ${payment.roll_no}\nClass/Section: ${payment.class} / ${payment.section}\nPayment Date: ${paymentDate}\nAmount Due: ${formatCurrency(payment.amount_due)}\nAmount Paid: ${formatCurrency(payment.amount_paid)}\nBalance: ${formatCurrency(payment.balance)}\n\nThank you for your payment.`;

      sendMail({
        to: payment.email,
        subject,
        text,
        html,
      }).catch(err => console.warn('Email send failed:', err.message));
    }

    res.status(201).json({ message: 'Fee payment recorded.', payment });
  } catch (err) { next(err); }
});

router.get('/student/:student_id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT fp.*,
              (fp.amount_due - fp.amount_paid) AS balance,
              s.first_name, s.last_name, s.roll_no, s.class, s.section
       FROM fee_payments fp
       JOIN students s ON s.student_id = fp.student_id
       WHERE fp.student_id = $1
       ORDER BY fp.academic_month DESC`,
      [req.params.student_id]
    );
    res.json({ count: rows.length, payments: rows });
  } catch (err) { next(err); }
});

router.get('/summary/monthly', async (req, res, next) => {
  try {
    const month = normalizeMonthInput(req.query.month) || `${new Date().toISOString().slice(0, 7)}-01`;
    const { rows } = await pool.query(
      `SELECT
         TO_CHAR(academic_month, 'Month YYYY') AS month_label,
         COUNT(*) AS payment_count,
         SUM(amount_due)  AS total_due,
         SUM(amount_paid) AS total_paid,
         SUM(amount_due - amount_paid) AS total_balance
       FROM fee_payments
       WHERE DATE_TRUNC('month', academic_month) = DATE_TRUNC('month', $1::DATE)
       GROUP BY academic_month`,
      [month]
    );
    res.json(rows[0] || { month_label: null, payment_count: 0, total_due: 0, total_paid: 0, total_balance: 0 });
  } catch (err) { next(err); }
});

router.get('/summary/yearly', async (req, res, next) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const { rows } = await pool.query(
      `SELECT
         TO_CHAR(academic_month, 'Mon YYYY') AS month_label,
         DATE_TRUNC('month', academic_month)  AS month_date,
         SUM(amount_due)  AS total_due,
         SUM(amount_paid) AS total_paid,
         SUM(amount_due - amount_paid) AS total_balance
       FROM fee_payments
       WHERE EXTRACT(YEAR FROM academic_month) = $1
       GROUP BY DATE_TRUNC('month', academic_month), TO_CHAR(academic_month, 'Mon YYYY')
       ORDER BY month_date`,
      [year]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

/* FIX: defaulter = a real fee_payments row for the month with
   amount_paid < amount_due. No more carrying forward stale dues
   for months the student was never actually billed. */
router.get('/defaulters', async (req, res, next) => {
  try {
    const month = normalizeMonthInput(req.query.month) || `${new Date().toISOString().slice(0, 7)}-01`;
    const { rows } = await pool.query(
      `SELECT
         s.student_id, s.roll_no, s.first_name, s.last_name,
         s.class, s.section, s.contact_1, s.father_name, s.admission_date,
         fp.amount_due, fp.amount_paid,
         (fp.amount_due - fp.amount_paid) AS balance,
         fp.payment_date
       FROM students s
       JOIN fee_payments fp
         ON fp.student_id = s.student_id
         AND DATE_TRUNC('month', fp.academic_month) = DATE_TRUNC('month', $1::DATE)
       WHERE fp.amount_due > 0
         AND fp.amount_paid < fp.amount_due
       ORDER BY balance DESC`,
      [month]
    );
    res.json({ count: rows.length, month, defaulters: rows });
  } catch (err) { next(err); }
});

router.get('/monthly-defaulters', async (req, res, next) => {
  try {
    const month = normalizeMonthInput(req.query.month) || `${new Date().toISOString().slice(0, 7)}-01`;
    const { rows } = await pool.query(
      `WITH student_months AS (
         SELECT s.student_id,
                s.roll_no,
                s.first_name,
                s.last_name,
                s.class,
                s.section,
                s.father_name,
                s.contact_1,
                s.contact_2,
                s.address,
                s.admission_date,
                generate_series(
                  DATE_TRUNC('month', s.admission_date),
                  DATE_TRUNC('month', $1::DATE),
                  INTERVAL '1 month'
                )::date AS academic_month
         FROM students s
         WHERE s.admission_date <= $1::DATE
       ),
       payment_agg AS (
         SELECT fp.student_id,
                DATE_TRUNC('month', fp.academic_month)::date AS academic_month,
                SUM(fp.amount_due)  AS amount_due,
                SUM(fp.amount_paid) AS amount_paid
         FROM fee_payments fp
         WHERE DATE_TRUNC('month', fp.academic_month) <= DATE_TRUNC('month', $1::DATE)
         GROUP BY fp.student_id, DATE_TRUNC('month', fp.academic_month)
       )
       SELECT sm.student_id,
              sm.roll_no,
              sm.first_name,
              sm.last_name,
              sm.class,
              sm.section,
              sm.father_name,
              sm.contact_1,
              sm.contact_2,
              sm.address,
              COUNT(*) FILTER (
                WHERE pa.amount_due IS NULL
                   OR COALESCE(pa.amount_paid, 0) < COALESCE(pa.amount_due, 0)
              ) AS overdue_months,
              SUM(COALESCE(pa.amount_due, 0))  AS total_due,
              SUM(COALESCE(pa.amount_paid, 0)) AS total_paid,
              SUM(COALESCE(pa.amount_due, 0) - COALESCE(pa.amount_paid, 0)) AS balance
       FROM student_months sm
       LEFT JOIN payment_agg pa
         ON pa.student_id = sm.student_id
         AND pa.academic_month = sm.academic_month
       GROUP BY sm.student_id, sm.roll_no, sm.first_name, sm.last_name,
                sm.class, sm.section, sm.father_name, sm.contact_1,
                sm.contact_2, sm.address, sm.admission_date
       HAVING COUNT(*) FILTER (
                WHERE pa.amount_due IS NULL
                   OR COALESCE(pa.amount_paid, 0) < COALESCE(pa.amount_due, 0)
              ) > 0
       ORDER BY overdue_months DESC, sm.class, sm.section, sm.roll_no`,
      [month]
    );
    const totalOverdueMonths = rows.reduce((sum, row) => sum + Number(row.overdue_months || 0), 0);
    res.json({ count: rows.length, month, total_overdue_months: totalOverdueMonths, defaulters: rows });
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const { month, class: cls, search } = req.query;
    let query = `
      SELECT fp.payment_id, fp.student_id, fp.academic_month, fp.amount_due, fp.amount_paid,
             fp.payment_date, s.roll_no, s.first_name, s.last_name, s.class, s.section
      FROM fee_payments fp
      JOIN students s ON s.student_id = fp.student_id
      WHERE 1=1`;
    const vals = [];
    let idx = 1;
    if (month) {
      const normalizedMonth = normalizeMonthInput(month) || month;
      query += ` AND DATE_TRUNC('month', fp.academic_month) = DATE_TRUNC('month', $${idx++}::DATE)`;
      vals.push(normalizedMonth);
    }
    if (cls) {
      query += ` AND s.class = $${idx++}`;
      vals.push(cls);
    }
    if (search) {
      query += ` AND (
        LOWER(s.first_name) LIKE $${idx} OR
        LOWER(s.last_name) LIKE $${idx} OR
        CAST(s.roll_no AS TEXT) LIKE $${idx}
      )`;
      vals.push(`%${search.toLowerCase()}%`);
      idx++;
    }
    query += ` ORDER BY fp.academic_month DESC, s.class, s.section, s.roll_no`;
    const { rows } = await pool.query(query, vals);
    res.json({ count: rows.length, payments: rows });
  } catch (err) { next(err); }
});

router.get('/daily', async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(
      `SELECT fp.payment_id, fp.student_id, fp.academic_month, fp.amount_due, fp.amount_paid,
              fp.payment_date, s.first_name, s.last_name, s.class, s.section
       FROM fee_payments fp
       JOIN students s ON s.student_id = fp.student_id
       WHERE DATE(fp.payment_date) = $1
       ORDER BY fp.payment_date DESC`,
      [date]
    );
    res.json({ count: rows.length, payments: rows });
  } catch (err) { next(err); }
});

// Editing an existing record is allowed for admin and principal.
// In this system there are only two roles: admin and principal.
router.put('/:payment_id', authorize('admin', 'principal'), async (req, res, next) => {
  try {
    const { amount_paid, amount_due } = req.body;
    if (amount_paid == null && amount_due == null) {
      return res.status(400).json({ error: 'amount_paid or amount_due is required.' });
    }

    // Editing an existing record (e.g. fixing a typo) should NOT touch
    // payment_date — that column reflects when the payment was actually
    // made/collected, not when someone last corrected the row. We only
    // update the columns that were actually sent.
    const sets = [];
    const vals = [];
    let idx = 1;
    if (amount_due != null) { sets.push(`amount_due = $${idx++}`);  vals.push(amount_due); }
    if (amount_paid != null) { sets.push(`amount_paid = $${idx++}`); vals.push(amount_paid); }
    vals.push(req.params.payment_id);

    const { rows } = await pool.query(
      `UPDATE fee_payments SET ${sets.join(', ')}
       WHERE payment_id = $${idx}
       RETURNING *`,
      vals
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Payment record not found.' });
    res.json({ message: 'Payment updated.', payment: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:payment_id', authorize('admin', 'principal'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM fee_payments WHERE payment_id = $1 RETURNING payment_id',
      [req.params.payment_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Payment record not found.' });
    res.json({ message: 'Payment deleted.' });
  } catch (err) { next(err); }
});

module.exports = router;