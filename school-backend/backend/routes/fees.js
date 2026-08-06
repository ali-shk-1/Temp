const router = require('express').Router();
const pool   = require('../db');
const { authenticate, authorize, can } = require('../middleware/authMiddleware');
const { sendMail } = require('../utils/mailer');
const { broadcast } = require('../sse');

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

router.post('/', can('fees.add'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { student_id, academic_month, amount_due, amount_paid } = req.body;
    if (!student_id || !academic_month || amount_due == null) {
      return res.status(400).json({ error: 'student_id, academic_month, and amount_due are required.' });
    }

    await client.query('BEGIN');

    // Serialize concurrent submissions for the same student so the
    // "does a fee record already exist for this month" check below and
    // the insert that follows can't race. Without this, two
    // near-simultaneous requests (double-click, or two staff members
    // recording payment at once) could both see "no existing row" and
    // both insert with the full amount_due, silently duplicating the
    // due amount in monthly totals. pg_advisory_xact_lock is held only
    // for this transaction and auto-released on COMMIT/ROLLBACK — no
    // schema change needed, and it doesn't conflict with the
    // intentional "second payment same month" pattern below, since that
    // path still runs, just one request at a time per student.
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [student_id]);

    const studentCheck = await client.query(
      'SELECT student_id FROM students WHERE student_id = $1', [student_id]
    );
    if (studentCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student not found.' });
    }

    // If a fee record already exists for this student and month, do not
    // duplicate the due amount; record only the paid amount as an extra
    // payment. This preserves daily payment history by payment_date while
    // keeping monthly totals tied to the fee's academic_month.
    const existingMonth = await client.query(
      `SELECT 1 FROM fee_payments
       WHERE student_id = $1
         AND DATE_TRUNC('month', academic_month) = DATE_TRUNC('month', $2::DATE)
       LIMIT 1`,
      [student_id, academic_month]
    );
    const insertedDue = existingMonth.rows.length ? 0 : amount_due;
    const insertedPaid = amount_paid || 0;

    const { rows } = await client.query(
      `INSERT INTO fee_payments (student_id, academic_month, amount_due, amount_paid)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [student_id, academic_month, insertedDue, insertedPaid]
    );

    // Re-fetch joined with student info so the client has everything it
    // needs to render/print a receipt without a second round-trip.
    //
    // amount_due/amount_paid/balance here are the MONTH'S TOTALS across
    // every fee_payments row for this student+month, not just the row
    // just inserted. That matters because a second-or-later payment in
    // the same month is deliberately inserted with amount_due=0 (see
    // insertedDue above) so monthly report totals aren't double-counted
    // — but showing that row's own amount_due=0 / negative balance on
    // the receipt itself made it look like the student owed nothing then
    // went negative, which is wrong and alarming to read. payment_id and
    // payment_date still identify the specific payment just made.
    const receipt = await client.query(
      `SELECT fp.payment_id, fp.student_id, fp.academic_month, fp.payment_date,
              fp.amount_paid AS this_payment_amount,
              month_totals.amount_due, month_totals.amount_paid,
              (month_totals.amount_due - month_totals.amount_paid) AS balance,
              s.roll_no, s.first_name, s.last_name, s.class, s.section,
              s.father_name, s.contact_1, s.contact_2, s.address, s.email, s.photo_url
       FROM fee_payments fp
       JOIN students s ON s.student_id = fp.student_id
       JOIN (
         SELECT student_id,
                DATE_TRUNC('month', academic_month) AS month,
                SUM(amount_due)  AS amount_due,
                SUM(amount_paid) AS amount_paid
         FROM fee_payments
         WHERE student_id = $2
           AND DATE_TRUNC('month', academic_month) = DATE_TRUNC('month', $3::DATE)
         GROUP BY student_id, DATE_TRUNC('month', academic_month)
       ) month_totals ON month_totals.student_id = fp.student_id
       WHERE fp.payment_id = $1`,
      [rows[0].payment_id, student_id, academic_month]
    );

    await client.query('COMMIT');

    const payment = receipt.rows[0];
    if (payment && payment.email && Number(payment.amount_paid) > 0) {
      // academic_month is a plain 'YYYY-MM-DD' string (pg DATE type parser
      // returns strings now) — parse it directly instead of routing through
      // `new Date()`, which is timezone-sensitive and can roll the month
      // back by one on servers whose local TZ is behind UTC.
      const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const [amYear, amMonth] = String(payment.academic_month).split('-');
      const formattedMonth = `${MONTH_NAMES[Number(amMonth) - 1]} ${amYear}`;
      // payment_date is queried elsewhere via DATE(fp.payment_date), which
      // implies it carries time info (TIMESTAMP), not a plain DATE — but
      // that isn't confirmable from the migrations alone (the fee_payments
      // table predates the tracked migration history). Parse the calendar
      // date directly out of the ISO string instead of routing through
      // `new Date(...).toLocaleDateString()`, which is timezone-sensitive
      // and can roll the day back by one for servers whose local TZ is
      // behind UTC — same bug already fixed for academic_month above.
      // Works correctly whether payment_date is 'YYYY-MM-DD' or a full
      // 'YYYY-MM-DDTHH:MM:SS...' timestamp.
      const DAY_MONTH_NAMES = MONTH_NAMES;
      function formatPaymentDate(d) {
        const match = d ? String(d).match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
        if (match) {
          const [, y, mo, day] = match;
          return `${Number(day)} ${DAY_MONTH_NAMES[Number(mo) - 1]} ${y}`;
        }
        const now = new Date();
        return `${now.getDate()} ${DAY_MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
      }
      const paymentDate = formatPaymentDate(payment.payment_date);
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
            <tr><td style="padding:8px;border:1px solid #ddd;">This Payment</td><td style="padding:8px;border:1px solid #ddd;">${formatCurrency(payment.this_payment_amount)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;">Amount Due (${formattedMonth})</td><td style="padding:8px;border:1px solid #ddd;">${formatCurrency(payment.amount_due)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;">Total Paid (${formattedMonth})</td><td style="padding:8px;border:1px solid #ddd;">${formatCurrency(payment.amount_paid)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;">Balance</td><td style="padding:8px;border:1px solid #ddd;">${formatCurrency(payment.balance)}</td></tr>
          </table>
          <p style="margin-top:16px;">If you have any questions or need further assistance, please contact the school office.</p>
          <p style="margin-top:8px;">Sincerely,<br/>School Administration</p>
        </div>`;
      const text = `Fee Payment Receipt\n\nStudent: ${payment.first_name} ${payment.last_name}\nRoll No: ${payment.roll_no}\nClass/Section: ${payment.class} / ${payment.section}\nPayment Date: ${paymentDate}\nThis Payment: ${formatCurrency(payment.this_payment_amount)}\nAmount Due (${formattedMonth}): ${formatCurrency(payment.amount_due)}\nTotal Paid (${formattedMonth}): ${formatCurrency(payment.amount_paid)}\nBalance: ${formatCurrency(payment.balance)}\n\nThank you for your payment.`;

      sendMail({
        to: payment.email,
        subject,
        text,
        html,
      }).catch(err => console.warn('Email send failed:', err.message));
    }

    res.status(201).json({ message: 'Fee payment recorded.', payment });
    broadcast('fees.changed', { action: 'added', payment_id: payment.payment_id });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rollbackErr) { /* connection may already be closed */ }
    next(err);
  } finally {
    client.release();
  }
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
                COALESCE(s.fee_start_month, DATE_TRUNC('month', s.admission_date)) AS fee_start_month,
                generate_series(
                  COALESCE(s.fee_start_month, DATE_TRUNC('month', s.admission_date)),
                  DATE_TRUNC('month', $1::DATE),
                  INTERVAL '1 month'
                )::date AS academic_month
         FROM students s
         WHERE COALESCE(s.fee_start_month, DATE_TRUNC('month', s.admission_date)) <= DATE_TRUNC('month', $1::DATE)
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
       -- One row PER STUDENT PER UNPAID MONTH (not collapsed/cumulative).
       -- This mirrors exactly what the dashboard's total_overdue_months
       -- already counts (one instance per defaulting student-month), so
       -- grouping these rows by academic_month and counting them per
       -- month will always sum to that same dashboard total.
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
              sm.academic_month,
              COALESCE(pa.amount_due, 0)  AS amount_due,
              COALESCE(pa.amount_paid, 0) AS amount_paid,
              (COALESCE(pa.amount_due, 0) - COALESCE(pa.amount_paid, 0)) AS balance
       FROM student_months sm
       LEFT JOIN payment_agg pa
         ON pa.student_id = sm.student_id
         AND pa.academic_month = sm.academic_month
       WHERE pa.amount_due IS NULL
          OR COALESCE(pa.amount_paid, 0) < COALESCE(pa.amount_due, 0)
       ORDER BY sm.academic_month DESC, sm.class, sm.section, sm.roll_no`,
      [month]
    );

    // Group the flat per-month rows into { academic_month, defaulters: [...] }
    // buckets so the frontend can show each month's own count, while the
    // flat `defaulters` array (all rows across all months) is also
    // returned so total_overdue_months / count keep meaning "total
    // defaulter-month instances", unchanged from before.
    const monthGroups = {};
    rows.forEach(row => {
      const key = String(row.academic_month).slice(0, 10);
      if (!monthGroups[key]) monthGroups[key] = [];
      monthGroups[key].push(row);
    });
    const months = Object.keys(monthGroups).sort((a, b) => b.localeCompare(a)).map(key => ({
      academic_month: key,
      count: monthGroups[key].length,
      defaulters: monthGroups[key],
    }));

    res.json({
      count: rows.length,
      month,
      total_overdue_months: rows.length,
      defaulters: rows,
      months,
    });
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const { month, class: cls, search } = req.query;
    let query = `
      SELECT
        MAX(fp.payment_id) AS payment_id,
        fp.student_id,
        DATE_TRUNC('month', fp.academic_month)::date AS academic_month,
        SUM(fp.amount_due)  AS amount_due,
        SUM(fp.amount_paid) AS amount_paid,
        MAX(fp.payment_date) AS payment_date,
        COUNT(*) AS payment_count,
        s.roll_no, s.first_name, s.last_name, s.class, s.section, s.photo_url
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
    query += `
      GROUP BY fp.student_id, DATE_TRUNC('month', fp.academic_month), s.roll_no,
               s.first_name, s.last_name, s.class, s.section, s.photo_url
      ORDER BY DATE_TRUNC('month', fp.academic_month) DESC, s.class, s.section, s.roll_no`;
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

// Editing an existing fee_payments record is gated by can('fees.edit'),
// which defaults to true for admin and principal — but any role (viewer
// included) can be granted it by ali from the Permissions page, and ali
// itself always passes regardless of role_permissions. There is no fixed
// two-role assumption baked in here.
router.put('/:payment_id', can('fees.edit'), async (req, res, next) => {
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
    broadcast('fees.changed', { action: 'updated', payment_id: rows[0].payment_id });
  } catch (err) { next(err); }
});

router.delete('/:payment_id', can('fees.delete'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM fee_payments WHERE payment_id = $1 RETURNING payment_id',
      [req.params.payment_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Payment record not found.' });
    res.json({ message: 'Payment deleted.' });
    broadcast('fees.changed', { action: 'deleted', payment_id: rows[0].payment_id });
  } catch (err) { next(err); }
});

module.exports = router;