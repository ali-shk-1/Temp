const router = require('express').Router();
const pool   = require('../db');
const { authenticate } = require('../middleware/authMiddleware');

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
    const currentYear  = new Date().getFullYear();

    const [
      studentsRes, staffRes, feesMonthRes, expensesMonthRes,
      defaultersRes, feesYearRes, expensesYearRes,
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) AS total FROM students'),
      pool.query('SELECT COUNT(*) AS total FROM staff'),
      // Two different questions, so two different date columns:
      //  - amount_due (what's owed for the month) is tied to academic_month,
      //    the fee period the charge is FOR.
      //  - amount_paid shown here ("Fee Collected (Month)") is tied to
      //    payment_date, the date the payment was actually RECEIVED — so if
      //    a student pays for March+April in August, that money counts
      //    toward August's collected total, not March/April's.
      pool.query(
        `SELECT COALESCE((
                  SELECT SUM(amount_due) FROM fee_payments
                  WHERE DATE_TRUNC('month', academic_month) = DATE_TRUNC('month', $1::DATE)
                ), 0) AS total_due,
                COALESCE((
                  SELECT SUM(amount_paid) FROM fee_payments
                  WHERE DATE_TRUNC('month', COALESCE(payment_date, academic_month)) = DATE_TRUNC('month', $1::DATE)
                ), 0) AS total_paid`,
        [currentMonth]
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total_expenses
         FROM expenses
         WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', $1::DATE)`,
        [currentMonth]
      ),
      // FIX: matches the corrected /api/fees/defaulters logic
      pool.query(
        `SELECT COUNT(*) AS total
         FROM fee_payments fp
         WHERE DATE_TRUNC('month', fp.academic_month) = DATE_TRUNC('month', $1::DATE)
           AND fp.amount_due > 0
           AND fp.amount_paid < fp.amount_due`,
        [currentMonth]
      ),
      pool.query(
        `SELECT TO_CHAR(academic_month, 'Mon') AS month,
                SUM(amount_paid) AS collected
         FROM fee_payments
         WHERE EXTRACT(YEAR FROM academic_month) = $1
         GROUP BY DATE_TRUNC('month', academic_month), TO_CHAR(academic_month, 'Mon')
         ORDER BY DATE_TRUNC('month', academic_month)`,
        [currentYear]
      ),
      pool.query(
        `SELECT TO_CHAR(created_at, 'Mon') AS month,
                SUM(amount) AS spent
         FROM expenses
         WHERE EXTRACT(YEAR FROM created_at) = $1
         GROUP BY DATE_TRUNC('month', created_at), TO_CHAR(created_at, 'Mon')
         ORDER BY DATE_TRUNC('month', created_at)`,
        [currentYear]
      ),
    ]);

    res.json({
      kpis: {
        total_students:   parseInt(studentsRes.rows[0].total),
        total_staff:      parseInt(staffRes.rows[0].total),
        fees_due:         parseFloat(feesMonthRes.rows[0].total_due),
        fees_collected:   parseFloat(feesMonthRes.rows[0].total_paid),
        fees_balance:     parseFloat(feesMonthRes.rows[0].total_due) - parseFloat(feesMonthRes.rows[0].total_paid),
        expenses_month:   parseFloat(expensesMonthRes.rows[0].total_expenses),
        fee_defaulters:   parseInt(defaultersRes.rows[0].total),
      },
      charts: {
        monthly_fees:     feesYearRes.rows,
        monthly_expenses: expensesYearRes.rows,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;