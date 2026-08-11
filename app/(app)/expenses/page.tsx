'use client';

/**
 * app/expenses/page.tsx — direct port of frontend/expenses.html.
 * Add/edit Expense modal, Category management modal, date-range +
 * category filters (This Month / Today / Clear quick buttons), stat
 * cards (month/today/year/top-category), category breakdown bars.
 */

import { useEffect, useState } from 'react';
import AuthedPage from '@/components/AuthedPage';
import { api, dbg, formatDate, formatMoney, normalizeList } from '@/lib/api-client';
import { showToast } from '@/lib/toast';
import { hasPerm, loadMyPermissions, refreshMyPermissions } from '@/lib/permissions-client';
import { useLiveUpdates } from '@/lib/useLiveUpdates';

interface Category {
  category_id: number;
  category_name: string;
}

interface Expense {
  expense_id: number;
  category_id: number;
  category_name: string | null;
  amount: number;
  description: string | null;
  created_at: string;
}

const todayStr = new Date().toISOString().slice(0, 10);
const monthStart = todayStr.slice(0, 7) + '-01';
const monthEnd = todayStr;

const emptyForm = {
  expense_id: '' as string | number,
  category_id: '',
  amount: '',
  description: '',
  date: todayStr,
};

export default function ExpensesPage() {
  return (
    <AuthedPage activePage="expenses">
      <ExpensesContent />
    </AuthedPage>
  );
}

function ExpensesContent() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(monthEnd);
  const [catFilter, setCatFilter] = useState('');

  const [statMonth, setStatMonth] = useState('—');
  const [statToday, setStatToday] = useState('—');
  const [statYear, setStatYear] = useState('—');
  const [statTopCat, setStatTopCat] = useState('—');

  const [expModalOpen, setExpModalOpen] = useState(false);
  const [expForm, setExpForm] = useState({ ...emptyForm });

  const [catModalOpen, setCatModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  const [permTick, setPermTick] = useState(0); // bump to re-render after permissions change

  async function loadCategories() {
    try {
      const catRaw = await api('GET', '/api/expenses/categories');
      dbg('categories raw', catRaw);
      setCategories(normalizeList<Category>(catRaw, ['categories', 'data']));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    }
  }

  async function loadExpenses() {
    setExpenses(null);
    const params = new URLSearchParams();
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    if (catFilter) params.set('category_id', catFilter);
    const url = '/api/expenses' + (params.toString() ? '?' + params.toString() : '');

    try {
      const raw = await api('GET', url);
      dbg('expenses raw', raw);
      const data = normalizeList<Expense>(raw, ['expenses', 'data', 'results']);
      setExpenses(data);
      setLoadFailed(false);
    } catch {
      setExpenses([]);
      setLoadFailed(true);
    }
  }

  async function loadStats() {
    try {
      const now = new Date();
      const yearStart = now.getFullYear() + '-01-01';

      const [monthData, todayData, yearData] = await Promise.all([
        api('GET', `/api/expenses?from=${monthStart}&to=${monthEnd}`),
        api('GET', `/api/expenses?from=${todayStr}&to=${todayStr}`),
        api('GET', `/api/expenses?from=${yearStart}&to=${todayStr}`),
      ]);

      const monthList = normalizeList<Expense>(monthData, ['expenses', 'data']);
      const todayList = normalizeList<Expense>(todayData, ['expenses', 'data']);
      const yearList = normalizeList<Expense>(yearData, ['expenses', 'data']);

      const sum = (arr: Expense[]) => arr.reduce((s, r) => s + (+r.amount || 0), 0);

      setStatMonth(formatMoney(sum(monthList)));
      setStatToday(formatMoney(sum(todayList)));
      setStatYear(formatMoney(sum(yearList)));

      // Top category from this month's data
      if (monthList.length) {
        const map: Record<string, number> = {};
        monthList.forEach((r) => {
          const k = r.category_name || 'Uncategorized';
          map[k] = (map[k] || 0) + (+r.amount || 0);
        });
        const top = Object.entries(map).sort((a, b) => b[1] - a[1])[0];
        setStatTopCat(top ? top[0] : '—');
      } else {
        setStatTopCat('—');
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('loadStats error:', e); // never leave catch empty!
    }
  }

  useEffect(() => {
    (async () => {
      await loadMyPermissions();
      setPermTick((n) => n + 1);
      await loadCategories();
      await Promise.all([loadExpenses(), loadStats()]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadExpenses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, catFilter]);

  useLiveUpdates({
    'expenses.changed': () => {
      loadExpenses();
      loadStats();
    },
    'expense-categories.changed': () => loadCategories(),
    'permissions.changed': () => refreshMyPermissions(() => setPermTick((n) => n + 1)),
  });

  function setThisMonth() {
    setDateFrom(monthStart);
    setDateTo(monthEnd);
  }
  function setToday() {
    setDateFrom(todayStr);
    setDateTo(todayStr);
  }
  function clearFilters() {
    setDateFrom('');
    setDateTo('');
    setCatFilter('');
  }

  const total = expenses ? expenses.reduce((s, r) => s + (+r.amount || 0), 0) : 0;

  const catBreakdown = (() => {
    if (!expenses || !expenses.length) return [];
    const map: Record<string, number> = {};
    expenses.forEach((r) => {
      const key = r.category_name || 'Uncategorized';
      map[key] = (map[key] || 0) + +r.amount;
    });
    const totalAmt = Object.values(map).reduce((a, b) => a + b, 0);
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, amt]) => ({ name, amt, pct: totalAmt > 0 ? Math.round((amt / totalAmt) * 100) : 0 }));
  })();

  async function editExpense(id: number) {
    try {
      const data = await api<Expense>('GET', `/api/expenses/${id}`);
      if (!data) throw new Error('Not found');
      setExpForm({
        expense_id: data.expense_id,
        category_id: String(data.category_id),
        amount: String(data.amount),
        description: data.description || '',
        date: data.created_at ? data.created_at.slice(0, 10) : todayStr,
      });
      setExpModalOpen(true);
    } catch {
      showToast('Could not load expense.', 'error');
    }
  }

  async function deleteExpense(id: number) {
    if (!confirm('Delete this expense?')) return;
    try {
      await api('DELETE', `/api/expenses/${id}`);
      showToast('Expense deleted.');
      loadExpenses();
      loadStats();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  function openExpModal() {
    setExpForm({ ...emptyForm, date: todayStr });
    setExpModalOpen(true);
  }
  function closeExpModal() {
    setExpModalOpen(false);
  }

  async function saveExpense() {
    const id = expForm.expense_id;
    const catId = expForm.category_id;
    const amount = parseFloat(expForm.amount);
    const desc = expForm.description.trim();
    const date = expForm.date;

    if (!catId) {
      showToast('Select a category.', 'error');
      return;
    }
    if (!amount || amount <= 0) {
      showToast('Enter a valid amount.', 'error');
      return;
    }

    const body = { category_id: parseInt(catId, 10), amount, description: desc, created_at: date };
    try {
      if (id) {
        await api('PUT', `/api/expenses/${id}`, body);
        showToast('Expense updated.');
      } else {
        await api('POST', '/api/expenses', body);
        showToast('Expense added.');
      }
      closeExpModal();
      loadExpenses();
      loadStats();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  // Category management
  function openCatModal() {
    setCatModalOpen(true);
  }
  function closeCatModal() {
    setCatModalOpen(false);
    loadCategories();
  }

  async function addCategory() {
    const name = newCatName.trim();
    if (!name) return;
    try {
      await api('POST', '/api/expenses/categories', { category_name: name });
      setNewCatName('');
      const catRaw = await api('GET', '/api/expenses/categories');
      setCategories(normalizeList<Category>(catRaw, ['categories', 'data']));
      showToast('Category added.');
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  async function deleteCategory(id: number, name: string) {
    if (!confirm(`Remove category "${name}"?`)) return;
    try {
      await api('DELETE', `/api/expenses/categories/${id}`);
      const catRaw = await api('GET', '/api/expenses/categories');
      setCategories(normalizeList<Category>(catRaw, ['categories', 'data']));
      showToast('Category removed.');
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  return (
    <>
      {/* Add/Edit Expense Modal */}
      <div className={`modal-overlay${expModalOpen ? ' open' : ''}`}>
        <div className="modal" style={{ maxWidth: 480 }}>
          <div className="modal-header">
            <h2 className="modal-title">{expForm.expense_id ? 'Edit Expense' : 'Add Expense'}</h2>
            <button className="modal-close" onClick={closeExpModal}>
              ×
            </button>
          </div>
          <form onSubmit={(e) => e.preventDefault()}>
            <div className="form-group">
              <label>Category *</label>
              <select
                value={expForm.category_id}
                onChange={(e) => setExpForm({ ...expForm, category_id: e.target.value })}
              >
                <option value="">Select category…</option>
                {categories.map((c) => (
                  <option key={c.category_id} value={c.category_id}>
                    {c.category_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Amount (Rs.) *</label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={expForm.amount}
                onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                rows={2}
                placeholder="Optional details…"
                value={expForm.description}
                onChange={(e) => setExpForm({ ...expForm, description: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Date</label>
              <input
                type="date"
                value={expForm.date}
                onChange={(e) => setExpForm({ ...expForm, date: e.target.value })}
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={closeExpModal}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={saveExpense}>
                Save Expense
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Category Modal */}
      <div className={`modal-overlay${catModalOpen ? ' open' : ''}`}>
        <div className="modal" style={{ maxWidth: 380 }}>
          <div className="modal-header">
            <h2 className="modal-title">Manage Categories</h2>
            <button className="modal-close" onClick={closeCatModal}>
              ×
            </button>
          </div>
          {hasPerm('expenses.categories') && (
            <div className="form-group">
              <label>New Category Name</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="e.g. Utilities"
                  className="mini-input"
                  style={{ flex: 1 }}
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                />
                <button className="btn btn-primary" onClick={addCategory}>
                  Add
                </button>
              </div>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            {categories.length === 0 ? (
              <p className="empty">No categories yet.</p>
            ) : (
              <div className="list-panel">
                {categories.map((c) => (
                  <div className="list-row" key={c.category_id}>
                    <span>{c.category_name}</span>
                    {hasPerm('expenses.categories') && (
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => deleteCategory(c.category_id, c.category_name)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Expenses</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            {hasPerm('expenses.categories') && (
              <button className="btn btn-outline" onClick={openCatModal}>
                Categories
              </button>
            )}
            {hasPerm('expenses.add') && (
              <button className="btn btn-primary" onClick={openExpModal}>
                + Add Expense
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="label">This Month</div>
            <div className="value">{statMonth}</div>
          </div>
          <div className="stat-card">
            <div className="label">Today</div>
            <div className="value">{statToday}</div>
          </div>
          <div className="stat-card">
            <div className="label">This Year</div>
            <div className="value">{statYear}</div>
          </div>
          <div className="stat-card">
            <div className="label">Top Category (Month)</div>
            <div className="value" style={{ fontSize: 14 }}>
              {statTopCat}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="filters">
            <label className="text-muted" style={{ fontSize: 12 }}>
              From:
            </label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <label className="text-muted" style={{ fontSize: 12 }}>
              To:
            </label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.category_id} value={c.category_id}>
                  {c.category_name}
                </option>
              ))}
            </select>
            <button className="btn btn-outline btn-sm" onClick={setThisMonth}>
              This Month
            </button>
            <button className="btn btn-outline btn-sm" onClick={setToday}>
              Today
            </button>
            <button className="btn btn-outline btn-sm" onClick={clearFilters}>
              Clear
            </button>
          </div>
        </div>

        {/* Two-column layout: table + category breakdown */}
        <div className="grid-2-1">
          <div className="card">
            <div className="section-title">All Expenses</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses === null ? (
                    <tr>
                      <td colSpan={6} className="loading">
                        Loading…
                      </td>
                    </tr>
                  ) : loadFailed ? (
                    <tr>
                      <td colSpan={6} className="empty">
                        Failed to load.
                      </td>
                    </tr>
                  ) : expenses.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="empty">
                        No expenses found.
                      </td>
                    </tr>
                  ) : (
                    expenses.map((r, i) => (
                      <tr key={r.expense_id}>
                        <td>{i + 1}</td>
                        <td>{formatDate(r.created_at)}</td>
                        <td>
                          <span className="badge badge-info">{r.category_name || '—'}</span>
                        </td>
                        <td className="ellipsis-cell" title={r.description || ''}>
                          {r.description || '—'}
                        </td>
                        <td className="amount-danger">{formatMoney(r.amount)}</td>
                        <td>
                          {hasPerm('expenses.edit') && (
                            <button className="btn btn-outline btn-sm" onClick={() => editExpense(r.expense_id)}>
                              Edit
                            </button>
                          )}
                          {hasPerm('expenses.delete') && (
                            <button className="btn btn-danger btn-sm" onClick={() => deleteExpense(r.expense_id)}>
                              Del
                            </button>
                          )}
                          {!hasPerm('expenses.edit') && !hasPerm('expenses.delete') && '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {expenses && expenses.length > 0 && (
              <div className="amount-danger" style={{ textAlign: 'right', fontSize: 13, padding: '10px 0 0' }}>
                Total: {formatMoney(total)}
              </div>
            )}
          </div>

          <div className="card">
            <div className="section-title">By Category</div>
            {expenses === null ? (
              <div className="loading">Loading…</div>
            ) : catBreakdown.length === 0 ? (
              <p className="empty">No data.</p>
            ) : (
              catBreakdown.map(({ name, amt, pct }) => (
                <div style={{ marginBottom: 12 }} key={name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span>{name}</span>
                    <span style={{ fontWeight: 600 }}>
                      {formatMoney(amt)}{' '}
                      <span className="text-muted" style={{ fontWeight: 400 }}>
                        ({pct}%)
                      </span>
                    </span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
