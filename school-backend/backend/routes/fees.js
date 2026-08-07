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

    // Issue a sequential, verifiable receipt for this payment. receipt_no
    // is a plain auto-increment (1, 2, 3, ...) distinct from payment_id,
    // so front-desk staff and parents can confirm a printed receipt is
    // legitimate by checking it maps back to a real payment here.
    const paymentRow = receipt.rows[0];
    let receiptNo = null;
    if (paymentRow) {
      const studentName = `${paymentRow.first_name || ''} ${paymentRow.last_name || ''}`.trim();
      const receiptInsert = await client.query(
        `INSERT INTO payment_receipts
           (payment_id, student_id, roll_no, student_name, class, section, academic_month, amount_due, amount_paid, print_mode, issued_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (payment_id) DO UPDATE SET payment_id = EXCLUDED.payment_id
         RETURNING receipt_no`,
        [
          rows[0].payment_id, student_id, paymentRow.roll_no, studentName,
          paymentRow.class, paymentRow.section, academic_month,
          paymentRow.amount_due, paymentRow.amount_paid,
          (req.body.print_mode === 'thermal' ? 'thermal' : 'paper'),
          req.user && req.user.username ? req.user.username : null
        ]
      );
      receiptNo = receiptInsert.rows[0] ? receiptInsert.rows[0].receipt_no : null;
    }

    await client.query('COMMIT');

    const payment = receipt.rows[0];
    if (payment) payment.receipt_no = receiptNo;
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
              s.first_name, s.last_name, s.roll_no, s.class, s.section,
              pr.receipt_no
       FROM fee_payments fp
       JOIN students s ON s.student_id = fp.student_id
       LEFT JOIN payment_receipts pr ON pr.payment_id = fp.payment_id
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
    // total_due/total_balance stay tied to academic_month (the fee period
    // being charged for). total_paid ("Fee Collected") is tied to
    // payment_date (the date money actually came in), so a payment made
    // today for a past-due month (e.g. March+April paid in August) counts
    // toward THIS month's collected total, not March/April's — matching
    // how the dashboard's "Fee Collected (Month)" card is meant to work.
    const { rows } = await pool.query(
      `SELECT
         TO_CHAR($1::DATE, 'Month YYYY') AS month_label,
         (SELECT COUNT(*) FROM fee_payments
           WHERE DATE_TRUNC('month', academic_month) = DATE_TRUNC('month', $1::DATE)) AS payment_count,
         (SELECT COALESCE(SUM(amount_due), 0) FROM fee_payments
           WHERE DATE_TRUNC('month', academic_month) = DATE_TRUNC('month', $1::DATE)) AS total_due,
         (SELECT COALESCE(SUM(amount_paid), 0) FROM fee_payments
           WHERE DATE_TRUNC('month', COALESCE(payment_date, academic_month)) = DATE_TRUNC('month', $1::DATE)) AS total_paid,
         (SELECT COALESCE(SUM(amount_due - amount_paid), 0) FROM fee_payments
           WHERE DATE_TRUNC('month', academic_month) = DATE_TRUNC('month', $1::DATE)) AS total_balance`,
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

/* ─────────────────────────────────────────
   TRACKING
   Groups fee_payments by the DATE the payment was actually made
   (payment_date), not the month it was billed for (academic_month).
   e.g. a June fee paid in August shows up under August here — this
   mirrors the "Fee Collected (Month)" logic already used on the
   dashboard and in /summary/monthly above.
───────────────────────────────────────── */

// GET /api/fees/tracking/monthly?month=YYYY-MM
// One row PER (student, fee-month-being-paid-for). If a student pays for
// two different academic_months (e.g. July + August dues) within this
// calendar month, that's two separate rows here — each with its own
// academic_month label — not merged into one, so nothing is silently
// summed together and hidden from view.
router.get('/tracking/monthly', async (req, res, next) => {
  try {
    const month = normalizeMonthInput(req.query.month) || `${new Date().toISOString().slice(0, 7)}-01`;
    const { rows } = await pool.query(
      `SELECT
         fp.student_id,
         DATE_TRUNC('month', fp.academic_month)::date AS academic_month,
         SUM(fp.amount_due)  AS amount_due,
         SUM(fp.amount_paid) AS amount_paid,
         MAX(fp.payment_date) AS last_payment_date,
         s.roll_no, s.first_name, s.last_name, s.class, s.section, s.father_name
       FROM fee_payments fp
       JOIN students s ON s.student_id = fp.student_id
       WHERE DATE_TRUNC('month', COALESCE(fp.payment_date, fp.academic_month)) = DATE_TRUNC('month', $1::DATE)
       GROUP BY fp.student_id, DATE_TRUNC('month', fp.academic_month), s.roll_no,
                s.first_name, s.last_name, s.class, s.section, s.father_name
       ORDER BY s.class, s.section, s.roll_no, academic_month`,
      [month]
    );
    const totals = rows.reduce((acc, r) => {
      acc.total_paid += Number(r.amount_paid) || 0;
      acc.total_due  += Number(r.amount_due)  || 0;
      return acc;
    }, { total_paid: 0, total_due: 0 });
    totals.total_balance = totals.total_due - totals.total_paid;
    res.json({ count: rows.length, month, students: rows, totals });
  } catch (err) { next(err); }
});

// GET /api/fees/tracking/yearly?year=YYYY
// One row per month with student-count + totals, for the year toggle view.
router.get('/tracking/yearly', async (req, res, next) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const { rows } = await pool.query(
      `SELECT
         TO_CHAR(month_date, 'Mon YYYY') AS month_label,
         month_date,
         student_count,
         total_due,
         total_paid,
         (total_due - total_paid) AS total_balance
       FROM (
         SELECT
           DATE_TRUNC('month', COALESCE(fp.payment_date, fp.academic_month)) AS month_date,
           COUNT(DISTINCT fp.student_id) AS student_count,
           SUM(fp.amount_due)  AS total_due,
           SUM(fp.amount_paid) AS total_paid
         FROM fee_payments fp
         WHERE EXTRACT(YEAR FROM COALESCE(fp.payment_date, fp.academic_month)) = $1
         GROUP BY DATE_TRUNC('month', COALESCE(fp.payment_date, fp.academic_month))
       ) t
       ORDER BY month_date`,
      [year]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   BALANCE SHEET
   Day-by-day (or month-by-month) ledger combining fee collections and
   expenses, with running (cumulative) totals — Fee / Total Fee / Expense /
   Total Expense / Balance / T.Balance, matching the reference layout.
───────────────────────────────────────── */

// GET /api/fees/balance-sheet/monthly?month=YYYY-MM
// One row per DAY within the given month, running totals reset at the
// start of that month (Total Fee/Total Expense/T.Balance are cumulative
// WITHIN the selected month only).
router.get('/balance-sheet/monthly', async (req, res, next) => {
  try {
    const month = normalizeMonthInput(req.query.month) || `${new Date().toISOString().slice(0, 7)}-01`;
    const { rows } = await pool.query(
      `WITH days AS (
         SELECT generate_series(
           DATE_TRUNC('month', $1::DATE),
           (DATE_TRUNC('month', $1::DATE) + INTERVAL '1 month - 1 day'),
           INTERVAL '1 day'
         )::date AS day
       ),
       fee_by_day AS (
         SELECT DATE(COALESCE(payment_date, academic_month)) AS day,
                SUM(amount_paid) AS fee
         FROM fee_payments
         WHERE DATE_TRUNC('month', COALESCE(payment_date, academic_month)) = DATE_TRUNC('month', $1::DATE)
         GROUP BY DATE(COALESCE(payment_date, academic_month))
       ),
       expense_by_day AS (
         SELECT DATE(created_at) AS day,
                SUM(amount) AS expense
         FROM expenses
         WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', $1::DATE)
         GROUP BY DATE(created_at)
       )
       SELECT
         d.day,
         COALESCE(f.fee, 0)      AS fee,
         COALESCE(e.expense, 0)  AS expense,
         SUM(COALESCE(f.fee, 0))     OVER (ORDER BY d.day) AS total_fee,
         SUM(COALESCE(e.expense, 0)) OVER (ORDER BY d.day) AS total_expense,
         (COALESCE(f.fee, 0) - COALESCE(e.expense, 0)) AS balance,
         SUM(COALESCE(f.fee, 0) - COALESCE(e.expense, 0)) OVER (ORDER BY d.day) AS t_balance
       FROM days d
       LEFT JOIN fee_by_day f ON f.day = d.day
       LEFT JOIN expense_by_day e ON e.day = d.day
       ORDER BY d.day`,
      [month]
    );
    const last = rows[rows.length - 1];
    res.json({
      month,
      days: rows,
      totals: {
        fee: last ? Number(last.total_fee) : 0,
        expense: last ? Number(last.total_expense) : 0,
        balance: last ? Number(last.t_balance) : 0,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/fees/balance-sheet/yearly?year=YYYY
// One row per MONTH within the given year. Each month's totals are
// independent — Total Fee/Total Expense/T.Balance reset to that month's
// own numbers, they do NOT accumulate across months (same behavior as the
// monthly view resetting at the start of each new month).
router.get('/balance-sheet/yearly', async (req, res, next) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const { rows } = await pool.query(
      `WITH months AS (
         SELECT generate_series(
           MAKE_DATE($1::int, 1, 1),
           MAKE_DATE($1::int, 12, 1),
           INTERVAL '1 month'
         )::date AS month_date
       ),
       fee_by_month AS (
         SELECT DATE_TRUNC('month', COALESCE(payment_date, academic_month))::date AS month_date,
                SUM(amount_paid) AS fee
         FROM fee_payments
         WHERE EXTRACT(YEAR FROM COALESCE(payment_date, academic_month)) = $1
         GROUP BY DATE_TRUNC('month', COALESCE(payment_date, academic_month))
       ),
       expense_by_month AS (
         SELECT DATE_TRUNC('month', created_at)::date AS month_date,
                SUM(amount) AS expense
         FROM expenses
         WHERE EXTRACT(YEAR FROM created_at) = $1
         GROUP BY DATE_TRUNC('month', created_at)
       )
       SELECT
         TO_CHAR(m.month_date, 'Mon YYYY') AS month_label,
         m.month_date,
         COALESCE(f.fee, 0)      AS fee,
         COALESCE(e.expense, 0)  AS expense,
         COALESCE(f.fee, 0)      AS total_fee,
         COALESCE(e.expense, 0)  AS total_expense,
         (COALESCE(f.fee, 0) - COALESCE(e.expense, 0)) AS balance,
         (COALESCE(f.fee, 0) - COALESCE(e.expense, 0)) AS t_balance
       FROM months m
       LEFT JOIN fee_by_month f ON f.month_date = m.month_date
       LEFT JOIN expense_by_month e ON e.month_date = m.month_date
       ORDER BY m.month_date`,
      [year]
    );
    const totals = rows.reduce((acc, r) => {
      acc.fee += Number(r.fee) || 0;
      acc.expense += Number(r.expense) || 0;
      return acc;
    }, { fee: 0, expense: 0 });
    totals.balance = totals.fee - totals.expense;
    res.json({
      year,
      months: rows,
      totals,
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
              fp.payment_date, s.first_name, s.last_name, s.class, s.section,
              pr.receipt_no
       FROM fee_payments fp
       JOIN students s ON s.student_id = fp.student_id
       LEFT JOIN payment_receipts pr ON pr.payment_id = fp.payment_id
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

// ---------------- Receipts (verification list) ----------------
//
// Row-wise listing of every receipt ever issued — used by the Receipts
// nav page so front-desk staff can look up "is receipt #N legit?" without
// storing/serving an actual receipt image (keeps the table tiny). Supports
// optional date-range and search filters.
router.get('/receipts', async (req, res, next) => {
  try {
    const { from, to, search } = req.query;
    let query = `
      SELECT pr.receipt_no, pr.payment_id, pr.student_id, pr.roll_no,
             pr.student_name, pr.class, pr.section, pr.academic_month,
             pr.amount_due, pr.amount_paid, pr.print_mode, pr.issued_at, pr.issued_by
      FROM payment_receipts pr
      WHERE 1=1`;
    const vals = [];
    let idx = 1;
    if (from) { query += ` AND DATE(pr.issued_at) >= $${idx++}`; vals.push(from); }
    if (to)   { query += ` AND DATE(pr.issued_at) <= $${idx++}`; vals.push(to); }
    if (search) {
      query += ` AND (
        LOWER(pr.student_name) LIKE $${idx} OR
        CAST(pr.roll_no AS TEXT) LIKE $${idx} OR
        CAST(pr.receipt_no AS TEXT) LIKE $${idx}
      )`;
      vals.push(`%${search.toLowerCase()}%`);
      idx++;
    }
    query += ` ORDER BY pr.receipt_no DESC`;
    const { rows } = await pool.query(query, vals);
    res.json({ count: rows.length, receipts: rows });
  } catch (err) { next(err); }
});

// Single-receipt lookup — "is this receipt number legit" verification.
router.get('/receipts/:receipt_no', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT pr.*, fp.payment_date
       FROM payment_receipts pr
       LEFT JOIN fee_payments fp ON fp.payment_id = pr.payment_id
       WHERE pr.receipt_no = $1`,
      [req.params.receipt_no]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No receipt found with that number.', valid: false });
    res.json({ valid: true, receipt: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;