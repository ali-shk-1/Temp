'use client';

/**
 * app/balance-sheet/page.tsx — direct port of frontend/balance-sheet.html.
 * Month/Year toggle; month view = daily ledger (fee/expense/balance per
 * day, Sundays highlighted in red), year view = monthly ledger. Zero
 * cells render as an em dash here specifically (fmtCell/fmtSigned),
 * unlike the rest of the app which shows "Rs. 0" via formatMoney.
 */

import { useEffect, useState } from 'react';
import AuthedPage from '@/components/AuthedPage';
import { api, dbg, formatDate, formatMoney } from '@/lib/api-client';
import { loadMyPermissions, refreshMyPermissions } from '@/lib/permissions-client';
import { useLiveUpdates } from '@/lib/useLiveUpdates';

interface LedgerRow {
  label: string;
  sunday?: boolean;
  fee?: number | string;
  total_fee?: number | string;
  expense?: number | string;
  total_expense?: number | string;
  balance?: number | string;
  t_balance?: number | string;
}

interface Totals {
  fee: number | string;
  expense: number | string;
  balance: number | string;
}

// formatMoney() always shows "Rs. 0" for zero/blank — the reference
// layout uses a plain dash for zero-value cells, so mirror that here
// specifically for this table (rest of the app keeps "Rs. 0").
function fmtCell(n: unknown): string {
  const v = Number(n) || 0;
  if (v === 0) return '\u2014';
  return v.toLocaleString('en-PK', { minimumFractionDigits: 0 });
}
function fmtSigned(n: unknown): string {
  const v = Number(n) || 0;
  if (v === 0) return '\u2014';
  const sign = v < 0 ? '-' : '';
  return sign + Math.abs(v).toLocaleString('en-PK', { minimumFractionDigits: 0 });
}

// Parses a plain 'YYYY-MM-DD' date string as a local calendar date (not
// UTC) so day-of-week comes out right regardless of the browser's
// timezone, then reports whether it's a Sunday.
function isSunday(dayStr?: string | null): boolean {
  const m = String(dayStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return false;
  const [, y, mo, d] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  return dt.getDay() === 0;
}

const currentMonthStr = new Date().toISOString().slice(0, 7);
const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);

export default function BalanceSheetPage() {
  return (
    <AuthedPage activePage="balance-sheet">
      <BalanceSheetContent />
    </AuthedPage>
  );
}

function BalanceSheetContent() {
  const [permTick, setPermTick] = useState(0);
  const [isYear, setIsYear] = useState(false);
  const [monthPicker, setMonthPicker] = useState(currentMonthStr);
  const [yearPicker, setYearPicker] = useState(String(currentYear));

  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [totals, setTotals] = useState<Totals>({ fee: 0, expense: 0, balance: 0 });
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function loadBalanceSheet() {
    setLoadFailed(false);
    try {
      let newRows: LedgerRow[];
      let newTotals: Totals;
      if (isYear) {
        const year = yearPicker || String(currentYear);
        const data = await api('GET', `/api/fees/balance-sheet/yearly?year=${year}`);
        dbg('balance-sheet yearly', data);
        newRows = ((data as any)?.months || []).map((r: any) => ({ label: r.month_label, ...r }));
        newTotals = (data as any)?.totals || { fee: 0, expense: 0, balance: 0 };
      } else {
        if (!monthPicker) return;
        const data = await api('GET', `/api/fees/balance-sheet/monthly?month=${monthPicker}`);
        dbg('balance-sheet monthly', data);
        newRows = ((data as any)?.days || []).map((r: any) => ({
          label: formatDate(r.day),
          sunday: isSunday(r.day),
          ...r,
        }));
        newTotals = (data as any)?.totals || { fee: 0, expense: 0, balance: 0 };
      }
      setRows(newRows);
      setTotals(newTotals);
      setLoaded(true);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setLoadFailed(true);
      setLoaded(true);
    }
  }

  useEffect(() => {
    (async () => {
      await loadMyPermissions();
      setPermTick((n) => n + 1);
      await loadBalanceSheet();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadBalanceSheet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isYear, monthPicker, yearPicker]);

  useLiveUpdates({
    'fees.changed': () => loadBalanceSheet(),
    'expenses.changed': () => loadBalanceSheet(),
    'permissions.changed': () => refreshMyPermissions(() => setPermTick((n) => n + 1)),
  });

  function setCurrentMonth() {
    setMonthPicker(currentMonthStr);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Balance Sheet</h1>
        <div className="period-switch">
          <span className={`period-label${isYear ? ' inactive' : ''}`}>Month</span>
          <label className="toggle-switch">
            <input type="checkbox" checked={isYear} onChange={(e) => setIsYear(e.target.checked)} />
            <span className="toggle-slider"></span>
          </label>
          <span className={`period-label${!isYear ? ' inactive' : ''}`}>Year</span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        {!isYear ? (
          <div className="filters">
            <label className="text-muted" style={{ fontSize: 12 }}>
              Month:
            </label>
            <input type="month" value={monthPicker} onChange={(e) => setMonthPicker(e.target.value)} />
            <button className="btn btn-outline btn-sm" onClick={setCurrentMonth}>
              This Month
            </button>
          </div>
        ) : (
          <div className="filters">
            <label className="text-muted" style={{ fontSize: 12 }}>
              Year:
            </label>
            <select value={yearPicker} onChange={(e) => setYearPicker(e.target.value)}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="bs-summary">
          <div className="block">
            <div className="big amount-success">{formatMoney(totals.fee)}</div>
            <div className="small">FEE</div>
          </div>
          <div className="block">
            <div className="big amount-danger">{formatMoney(totals.expense)}</div>
            <div className="small">Expense</div>
          </div>
          <div className="block">
            <div className="big">{formatMoney(totals.balance)}</div>
            <div className="small">Balance</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">{isYear ? 'Monthly Ledger' : 'Daily Ledger'}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Date</th>
                <th>Fee</th>
                <th>Total Fee</th>
                <th>Expense</th>
                <th>Total Expense</th>
                <th>Balance</th>
                <th>T.Balance</th>
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                <tr>
                  <td colSpan={7} className="loading">
                    Loading…
                  </td>
                </tr>
              ) : loadFailed ? (
                <tr>
                  <td colSpan={7} className="empty">
                    Failed to load.
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    No data for this period.
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={i} className={r.sunday ? 'is-sunday' : ''}>
                    <td style={{ textAlign: 'left' }}>
                      {r.label}
                      {r.sunday && <span style={{ fontSize: 11 }}> (Sun)</span>}
                    </td>
                    <td className={Number(r.fee) > 0 ? 'amount-success' : ''}>{fmtCell(r.fee)}</td>
                    <td>{fmtCell(r.total_fee)}</td>
                    <td className={Number(r.expense) > 0 ? 'amount-danger' : ''}>{fmtCell(r.expense)}</td>
                    <td>{fmtCell(r.total_expense)}</td>
                    <td className={Number(r.balance) < 0 ? 'amount-danger' : ''}>{fmtSigned(r.balance)}</td>
                    <td className={Number(r.t_balance) < 0 ? 'amount-danger' : ''}>{fmtSigned(r.t_balance)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td>{loaded && !loadFailed ? formatMoney(totals.fee) : '—'}</td>
                <td>—</td>
                <td>{loaded && !loadFailed ? formatMoney(totals.expense) : '—'}</td>
                <td>—</td>
                <td>{loaded && !loadFailed ? formatMoney(totals.balance) : '—'}</td>
                <td>—</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <style jsx>{`
        .period-switch {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .period-label {
          font-size: 13px;
          font-weight: 600;
          color: var(--text);
        }
        .period-label.inactive {
          color: var(--muted);
          font-weight: 400;
        }
        .bs-summary {
          display: flex;
          flex-wrap: wrap;
          gap: 24px;
        }
        .bs-summary .block {
          min-width: 120px;
        }
        .bs-summary .big {
          font-size: 22px;
          font-weight: 700;
        }
        .bs-summary .small {
          font-size: 12px;
          color: var(--muted);
          margin-top: 2px;
        }
        :global(#bsTableBody td),
        :global(#bsTableBody th) {
          text-align: right;
        }
        table tbody td:first-child,
        table thead th:first-child {
          text-align: left;
        }
        table tfoot td {
          font-weight: 700;
          border-top: 2px solid var(--border);
        }
        tr.is-sunday td {
          color: #e0433f;
        }
        /* Fixed light-mode red loses contrast on the dark background --
           brighten to match .fee-unpaid/.amount-danger/.badge-danger
           elsewhere in the app. :global() needed since <style jsx> is
           scoped to this component. */
        :global([data-theme='dark']) tr.is-sunday td {
          color: #ff8a7a;
        }
        tr.is-sunday td:first-child {
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}