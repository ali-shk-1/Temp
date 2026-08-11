'use client';

/**
 * app/dashboard/page.tsx — direct port of frontend/dashboard.html.
 * Same stat cards, same month picker (last 12 months), same today's
 * collections / defaulters / monthly summary / recent expenses sections,
 * same live-update wiring.
 */

import { useEffect, useMemo, useState } from 'react';
import AuthedPage from '@/components/AuthedPage';
import { api, formatDate, formatMoney, formatMoneyHtml, normalizeList } from '@/lib/api-client';
import { useLiveUpdates } from '@/lib/useLiveUpdates';
import { refreshMyPermissions } from '@/lib/permissions-client';

function monthOptions(): { value: string; label: string }[] {
  const now = new Date();
  const opts: { value: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    opts.push({ value: val, label });
  }
  return opts;
}

export default function DashboardPage() {
  return (
    <AuthedPage activePage="dashboard">
      <DashboardContent />
    </AuthedPage>
  );
}

function DashboardContent() {
  const months = useMemo(() => monthOptions(), []);
  const [month, setMonth] = useState(months[0]?.value || '');
  const [todayDate, setTodayDate] = useState('');

  const [statStudents, setStatStudents] = useState('—');
  const [statStaff, setStatStaff] = useState('—');
  const [statFeeMonthHtml, setStatFeeMonthHtml] = useState('—');
  const [statExpMonthHtml, setStatExpMonthHtml] = useState('—');
  const [statOverdueMonths, setStatOverdueMonths] = useState<number | string>('—');
  const [statBalanceHtml, setStatBalanceHtml] = useState('—');
  const [balancePositive, setBalancePositive] = useState(true);

  const [todayFeesHtml, setTodayFeesHtml] = useState('Loading…');
  const [defaultersHtml, setDefaultersHtml] = useState('Loading…');
  const [monthlySummaryRows, setMonthlySummaryRows] = useState<React.ReactNode>(
    <tr>
      <td colSpan={8} className="loading">
        Loading…
      </td>
    </tr>
  );
  const [recentExpensesRows, setRecentExpensesRows] = useState<React.ReactNode>(
    <tr>
      <td colSpan={5} className="loading">
        Loading…
      </td>
    </tr>
  );

  useEffect(() => {
    setTodayDate(
      new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    );
  }, []);

  async function loadStats() {
    try {
      const monthDate = month + '-01';
      const monthEnd = new Date(Number(month.split('-')[0]), Number(month.split('-')[1]), 0)
        .toISOString()
        .slice(0, 10);

      const results = await Promise.allSettled([
        api('GET', '/api/students'),
        api('GET', '/api/staff'),
        api('GET', `/api/fees/summary/monthly?month=${monthDate}`),
        api('GET', `/api/fees/monthly-defaulters?month=${monthDate}`),
        api('GET', `/api/expenses?from=${monthDate}&to=${monthEnd}`),
      ]);

      const [studentsRes, staffRes, feeSumRes, defaultersRes, expListRes] = results;

      if (studentsRes.status === 'fulfilled') setStatStudents(String(normalizeList(studentsRes.value).length));
      if (staffRes.status === 'fulfilled') setStatStaff(String(normalizeList(staffRes.value).length));

      const feeSumVal: any = feeSumRes.status === 'fulfilled' ? feeSumRes.value : null;
      const collected = +(feeSumVal?.total_paid ?? feeSumVal?.total_collected ?? feeSumVal?.total ?? 0);
      setStatFeeMonthHtml(formatMoneyHtml(collected));

      const overdueMonthsVal: any = defaultersRes.status === 'fulfilled' ? defaultersRes.value : null;
      const overdueMonths = Number.isFinite(Number(overdueMonthsVal?.total_overdue_months))
        ? Number(overdueMonthsVal.total_overdue_months)
        : normalizeList(overdueMonthsVal?.defaulters || overdueMonthsVal).reduce(
            (sum: number, r: any) => sum + (+r.overdue_months || 0),
            0
          );
      setStatOverdueMonths(overdueMonths);

      const rawExp: any = expListRes.status === 'fulfilled' ? expListRes.value : {};
      const expData = normalizeList(rawExp);
      const expenses = expData.reduce((s: number, r: any) => s + (+r.amount || 0), 0);
      setStatExpMonthHtml(formatMoneyHtml(expenses));

      const balance = collected - expenses;
      setStatBalanceHtml(formatMoneyHtml(balance));
      setBalancePositive(balance >= 0);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('loadStats error:', e);
    }
  }

  async function loadTodayFees() {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const data = normalizeList<any>(await api('GET', `/api/fees/daily?date=${today}`));

      if (!data.length) {
        setTodayFeesHtml('<p class="empty">No fee collections today.</p>');
        return;
      }

      const total = data.reduce((s, r) => s + (+r.amount_paid || 0), 0);
      const html = `
        <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Student</th><th>Class</th><th>Amount Paid</th></tr></thead>
          <tbody>
            ${data
              .map(
                (r, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${r.first_name} ${r.last_name}</td>
                <td>${r.class}-${r.section}</td>
                <td class="fee-paid">${formatMoney(r.amount_paid)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
        </div>
        <p class="text-muted" style="font-size:12px;margin-top:8px;">
          Total: <strong>${formatMoney(total)}</strong>
        </p>`;
      setTodayFeesHtml(html);
    } catch {
      setTodayFeesHtml('<p class="empty">Could not load.</p>');
    }
  }

  async function loadDefaulters() {
    const m = month + '-01';
    try {
      const res: any = await api('GET', `/api/fees/monthly-defaulters?month=${m}`);
      const data = normalizeList<any>(res.defaulters || res);
      const totalOverdue = res.total_overdue_months ?? data.reduce((sum, r) => sum + (+r.overdue_months || 0), 0);

      if (!data.length) {
        setDefaultersHtml('<p class="empty">No overdue months this month. 🎉</p>');
        return;
      }

      const html = `
        <div class="text-muted" style="margin-bottom:10px;font-size:13px;">
          Total overdue months: <strong>${totalOverdue}</strong>
        </div>
        <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Student</th><th>Class</th><th>Overdue Months</th><th>Due</th><th>Paid</th></tr></thead>
          <tbody>
            ${data
              .slice(0, 8)
              .map(
                (r, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${r.first_name} ${r.last_name}</td>
                <td>${r.class}-${r.section}</td>
                <td>${r.overdue_months || 0}</td>
                <td class="${(+r.total_due || 0) > 0 ? 'fee-unpaid' : ''}">${formatMoney(r.total_due)}</td>
                <td>${formatMoney(r.total_paid)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
        </div>
        ${
          data.length > 8
            ? `<p class="text-muted" style="font-size:12px;margin-top:6px;">
                +${data.length - 8} more — <a href="/fees">View all</a>
               </p>`
            : ''
        }`;
      setDefaultersHtml(html);
    } catch {
      setDefaultersHtml('<p class="empty">Could not load.</p>');
    }
  }

  async function loadMonthlySummary() {
    setMonthlySummaryRows(
      <tr>
        <td colSpan={8} className="loading">
          Loading…
        </td>
      </tr>
    );
    const m = month + '-01';
    try {
      const data = normalizeList<any>(await api('GET', `/api/fees?month=${m}`));

      if (!data.length) {
        setMonthlySummaryRows(
          <tr>
            <td colSpan={8} className="empty">
              No records for this month.
            </td>
          </tr>
        );
        return;
      }

      setMonthlySummaryRows(
        data.map((r, i) => {
          const due = +r.amount_due || 0;
          const paid = +r.amount_paid || 0;
          let status: string;
          let cls: string;
          if (paid >= due && due > 0) {
            status = 'Paid';
            cls = 'badge-success';
          } else if (paid > 0) {
            status = 'Partial';
            cls = 'badge-warning';
          } else {
            status = 'Unpaid';
            cls = 'badge-danger';
          }
          return (
            <tr key={r.payment_id ?? i}>
              <td>{i + 1}</td>
              <td>
                {r.first_name} {r.last_name}
              </td>
              <td>{r.class}</td>
              <td>{r.section}</td>
              <td>{formatMoney(due)}</td>
              <td>{formatMoney(paid)}</td>
              <td>
                <span className={`badge ${cls}`}>{status}</span>
              </td>
              <td>{r.payment_date ? formatDate(r.payment_date) : '—'}</td>
            </tr>
          );
        })
      );
    } catch {
      setMonthlySummaryRows(
        <tr>
          <td colSpan={8} className="empty">
            Could not load.
          </td>
        </tr>
      );
    }
  }

  async function loadRecentExpenses() {
    try {
      const data = normalizeList<any>(await api('GET', '/api/expenses?limit=10'));

      if (!data.length) {
        setRecentExpensesRows(
          <tr>
            <td colSpan={5} className="empty">
              No expenses yet.
            </td>
          </tr>
        );
        return;
      }

      setRecentExpensesRows(
        data.map((r, i) => (
          <tr key={r.expense_id ?? i}>
            <td>{i + 1}</td>
            <td>{formatDate(r.created_at)}</td>
            <td>{r.category_name || '—'}</td>
            <td>{r.description || '—'}</td>
            <td>{formatMoney(r.amount)}</td>
          </tr>
        ))
      );
    } catch {
      setRecentExpensesRows(
        <tr>
          <td colSpan={5} className="empty">
            Could not load.
          </td>
        </tr>
      );
    }
  }

  // Boot + reload on month change
  useEffect(() => {
    loadStats();
    loadTodayFees();
    loadDefaulters();
    loadMonthlySummary();
    loadRecentExpenses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useLiveUpdates({
    'students.changed': () => {
      loadStats();
      loadDefaulters();
    },
    'left-students.changed': () => loadStats(),
    'fees.changed': () => {
      loadStats();
      loadTodayFees();
      loadDefaulters();
      loadMonthlySummary();
    },
    'expenses.changed': () => {
      loadStats();
      loadRecentExpenses();
      loadMonthlySummary();
    },
    'staff.changed': () => loadStats(),
    'permissions.changed': () => refreshMyPermissions(),
  });

  return (
    <div className="page">
      <div className="page-header" style={{ alignItems: 'center', gap: 10 }}>
        <div>
          <h1 className="page-title">Dashboard</h1>
          <span className="text-muted" style={{ fontSize: 13 }}>
            {todayDate}
          </span>
        </div>
        <button className="btn btn-primary" onClick={() => (window.location.href = '/fees?action=record-payment')}>
          Record Fee
        </button>
      </div>

      {/* Stats Row — each card shows a shimmering skeleton until its
          value has actually loaded (still '—'), instead of flashing an
          em-dash placeholder that reads as broken/empty on first paint. */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Total Students</div>
          <div className={`value ${statStudents === '—' ? 'skeleton' : ''}`}>{statStudents === '—' ? '000' : statStudents}</div>
        </div>
        <div className="stat-card">
          <div className="label">Total Staff</div>
          <div className={`value ${statStaff === '—' ? 'skeleton' : ''}`}>{statStaff === '—' ? '000' : statStaff}</div>
        </div>
        <div className="stat-card">
          <div className="label">Fee Collected</div>
          <div className={`value ${statFeeMonthHtml === '—' ? 'skeleton' : ''}`} dangerouslySetInnerHTML={{ __html: statFeeMonthHtml === '—' ? '00000' : statFeeMonthHtml }} />
        </div>
        <div className="stat-card">
          <div className="label">Expenses (Month)</div>
          <div className={`value ${statExpMonthHtml === '—' ? 'skeleton' : ''}`} dangerouslySetInnerHTML={{ __html: statExpMonthHtml === '—' ? '00000' : statExpMonthHtml }} />
        </div>
        <div className="stat-card">
          <div className="label">Overdue Months</div>
          <div className={`value ${statOverdueMonths === '—' ? 'skeleton' : (Number(statOverdueMonths) > 0 ? 'amount-danger' : '')}`}>{statOverdueMonths === '—' ? '0' : statOverdueMonths}</div>
        </div>
        <div className="stat-card">
          <div className="label">Balance (Month)</div>
          <div
            className={`value ${statBalanceHtml === '—' ? 'skeleton' : (balancePositive ? 'amount-success' : 'amount-danger')}`}
            dangerouslySetInnerHTML={{ __html: statBalanceHtml === '—' ? '00000' : statBalanceHtml }}
          />
        </div>
      </div>

      {/* Today + Defaulters */}
      <div className="grid-2">
        <div className="card">
          <div className="section-title">Today's Fee Collections</div>
          {todayFeesHtml === 'Loading…' ? (
            <div>
              <div className="skeleton skeleton-text" style={{ width: '80%' }} />
              <div className="skeleton skeleton-text" style={{ width: '60%' }} />
              <div className="skeleton skeleton-text" style={{ width: '70%' }} />
            </div>
          ) : (
            <div dangerouslySetInnerHTML={{ __html: todayFeesHtml }} />
          )}
        </div>
        <div className="card">
          <div className="section-title">Fee Defaulters — Selected Month</div>
          {defaultersHtml === 'Loading…' ? (
            <div>
              <div className="skeleton skeleton-text" style={{ width: '75%' }} />
              <div className="skeleton skeleton-text" style={{ width: '65%' }} />
              <div className="skeleton skeleton-text" style={{ width: '55%' }} />
            </div>
          ) : (
            <div dangerouslySetInnerHTML={{ __html: defaultersHtml }} />
          )}
        </div>
      </div>

      {/* Monthly Fee Summary */}
      <div className="card">
        <div className="section-title">Monthly Fee Summary</div>
        <div className="filters" style={{ marginBottom: 12 }}>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Student</th>
                <th>Class</th>
                <th>Section</th>
                <th>Amount Due</th>
                <th>Amount Paid</th>
                <th>Status</th>
                <th>Payment Date</th>
              </tr>
            </thead>
            <tbody>{monthlySummaryRows}</tbody>
          </table>
        </div>
      </div>

      {/* Recent Expenses */}
      <div className="card">
        <div className="section-title">Recent Expenses (Last 10)</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>Category</th>
                <th>Description</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>{recentExpensesRows}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}