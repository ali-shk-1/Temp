const router = require('express').Router();
const pool   = require('../db');
const { authenticate, authorize, can } = require('../middleware/authMiddleware');

router.use(authenticate);

/* ─────────────────────────────────────────
   EXPENSE CATEGORIES
───────────────────────────────────────── */

// GET /api/expenses/categories
router.get('/categories', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM expense_categories ORDER BY category_name'
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/expenses/categories
router.post('/categories', can('expenses.categories'), async (req, res, next) => {
  try {
    const { category_name } = req.body;
    if (!category_name) return res.status(400).json({ error: 'category_name is required.' });

    const { rows } = await pool.query(
      'INSERT INTO expense_categories (category_name) VALUES ($1) RETURNING *',
      [category_name]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/expenses/categories/:id  — admin only
router.delete('/categories/:id', can('expenses.categories'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM expense_categories WHERE category_id = $1 RETURNING *',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Category not found.' });
    res.json({ message: 'Category deleted.' });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   EXPENSES CRUD
───────────────────────────────────────── */

// GET /api/expenses
// Query: ?category_id=  &from=YYYY-MM-DD  &to=YYYY-MM-DD  &month=YYYY-MM
router.get('/', async (req, res, next) => {
  try {
    const { category_id, from, to, month } = req.query;

    let query = `
      SELECT e.*, ec.category_name
      FROM expenses e
      LEFT JOIN expense_categories ec ON ec.category_id = e.category_id
      WHERE 1=1`;
    const vals = [];
    let idx = 1;

    if (category_id) {
      query += ` AND e.category_id = $${idx++}`;
      vals.push(category_id);
    }
    if (month) {
      query += ` AND DATE_TRUNC('month', e.created_at) = DATE_TRUNC('month', $${idx++}::DATE)`;
      vals.push(`${month}-01`);
    } else {
      if (from) {
        query += ` AND e.created_at >= $${idx++}`;
        vals.push(from);
      }
      if (to) {
        query += ` AND e.created_at <= $${idx++}`;
        vals.push(to);
      }
    }

    query += ' ORDER BY e.created_at DESC';
    const { rows } = await pool.query(query, vals);
    res.json({ count: rows.length, expenses: rows });
  } catch (err) { next(err); }
});

// GET /api/expenses/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*, ec.category_name
       FROM expenses e
       LEFT JOIN expense_categories ec ON ec.category_id = e.category_id
       WHERE e.expense_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Expense not found.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// POST /api/expenses
router.post('/', can('expenses.add'), async (req, res, next) => {
  try {
    const { category_id, amount, description, created_at } = req.body;

    if (!amount) return res.status(400).json({ error: 'amount is required.' });
    if (isNaN(parseFloat(amount))) return res.status(400).json({ error: 'amount must be a number.' });

    const { rows } = await pool.query(
      `INSERT INTO expenses (category_id, amount, description, created_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [category_id || null, amount, description || null, created_at || new Date()]
    );
    res.status(201).json({ message: 'Expense recorded.', expense: rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/expenses/:id
router.put('/:id', can('expenses.edit'), async (req, res, next) => {
  try {
    const { category_id, amount, description, created_at } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount is required.' });

    const { rows } = await pool.query(
      `UPDATE expenses SET category_id=$1, amount=$2, description=$3, created_at=$4
       WHERE expense_id=$5
       RETURNING *`,
      [category_id || null, amount, description || null, created_at || new Date(), req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Expense not found.' });
    res.json({ message: 'Expense updated.', expense: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/expenses/:id  — admin only
router.delete('/:id', can('expenses.delete'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM expenses WHERE expense_id = $1 RETURNING expense_id',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Expense not found.' });
    res.json({ message: 'Expense deleted.' });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   REPORTS
───────────────────────────────────────── */

// GET /api/expenses/reports/by-category?month=YYYY-MM  (or ?from=&to=)
router.get('/reports/by-category', async (req, res, next) => {
  try {
    const { month, from, to } = req.query;
    let dateFilter = '';
    const vals = [];
    let idx = 1;

    if (month) {
      dateFilter = `AND DATE_TRUNC('month', e.created_at) = DATE_TRUNC('month', $${idx++}::DATE)`;
      vals.push(`${month}-01`);
    } else if (from && to) {
      dateFilter = `AND e.created_at BETWEEN $${idx++} AND $${idx++}`;
      vals.push(from, to);
    }

    const { rows } = await pool.query(
      `SELECT
         ec.category_name,
         COUNT(*) AS transaction_count,
         SUM(e.amount) AS total_amount
       FROM expenses e
       LEFT JOIN expense_categories ec ON ec.category_id = e.category_id
       WHERE 1=1 ${dateFilter}
       GROUP BY ec.category_name
       ORDER BY total_amount DESC`,
      vals
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/expenses/reports/monthly-trend?year=YYYY
router.get('/reports/monthly-trend', async (req, res, next) => {
  try {
    const year = req.query.year || new Date().getFullYear();

    const { rows } = await pool.query(
      `SELECT
         TO_CHAR(created_at, 'Mon YYYY') AS month_label,
         DATE_TRUNC('month', created_at)  AS month_date,
         SUM(amount) AS total_amount,
         COUNT(*) AS transaction_count
       FROM expenses
       WHERE EXTRACT(YEAR FROM created_at) = $1
       GROUP BY DATE_TRUNC('month', created_at), TO_CHAR(created_at, 'Mon YYYY')
       ORDER BY month_date`,
      [year]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
