'use client';

/**
 * app/receipts/page.tsx — direct port of frontend/receipts.html.
 * Read-only ledger of every fee receipt issued (sequential receipt
 * numbers), with a from/to date filter plus a free-text search across
 * receipt #, name, roll no., and class.
 */

import { useEffect, useMemo, useState } from 'react';
import AuthedPage from '@/components/AuthedPage';
import { api, dbg, formatDate, formatMoney } from '@/lib/api-client';
import { loadMyPermissions, refreshMyPermissions } from '@/lib/permissions-client';
import { useLiveUpdates } from '@/lib/useLiveUpdates';

interface ReceiptRow {
  receipt_no: number | string;
  student_name?: string;
  roll_no?: number | string | null;
  class?: string;
  section?: string;
  academic_month?: string;
  amount_due?: number | string;
  amount_paid?: number | string;
  print_mode?: string;
  issued_at?: string;
  issued_by?: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Same month-label formatting used across the Fees pages, so a stored
// 'YYYY-MM-01' date reads as e.g. "August 2026" here too.
function monthLabel(d?: string | null): string {
  if (!d) return '—';
  const m = String(d).match(/^(\d{4})-(\d{2})/);
  if (!m) return '—';
  return `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
}

export default function ReceiptsPage() {
  return (
    <AuthedPage activePage="receipts">
      <ReceiptsContent />
    </AuthedPage>
  );
}

function ReceiptsContent() {
  const [permTick, setPermTick] = useState(0);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [list, setList] = useState<ReceiptRow[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function loadReceipts() {
    setLoadFailed(false);
    try {
      const params: string[] = [];
      if (from) params.push(`from=${from}`);
      if (to) params.push(`to=${to}`);
      const qs = params.length ? `?${params.join('&')}` : '';
      const data = await api('GET', `/api/fees/receipts${qs}`);
      dbg('receipts', data);
      setList((data as any)?.receipts || []);
      setLoaded(true);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setLoadFailed(true);
      setLoaded(true);
    }
  }

  function clearFilters() {
    setFrom('');
    setTo('');
    setSearch('');
  }

  useEffect(() => {
    (async () => {
      await loadMyPermissions();
      setPermTick((n) => n + 1);
      await loadReceipts();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadReceipts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  useLiveUpdates({
    'fees.changed': () => loadReceipts(),
    'permissions.changed': () => refreshMyPermissions(() => setPermTick((n) => n + 1)),
  });

  const filtered = useMemo(() => {
    const raw = search.trim();
    const q = raw.replace(/^#/, '').toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        String(r.receipt_no).toLowerCase().includes(q) ||
        String(r.roll_no || '').toLowerCase().includes(q) ||
        String(r.student_name || '').toLowerCase().includes(q) ||
        String(r.class || '').toLowerCase().includes(q) ||
        String(r.section || '').toLowerCase().includes(q) ||
        String(r.issued_by || '').toLowerCase().includes(q)
    );
  }, [list, search]);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Receipts</h1>
      </div>

      <div className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Every fee payment gets a sequential receipt number automatically. Use this list to confirm a printed or
        reported receipt number is legitimate — no receipt images are stored here, only the record details.
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="filters">
          <label className="text-muted" style={{ fontSize: 12 }}>
            From:
          </label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <label className="text-muted" style={{ fontSize: 12 }}>
            To:
          </label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="btn btn-outline btn-sm" onClick={clearFilters}>
            Clear
          </button>
        </div>
        <div className="filters" style={{ marginBottom: 0 }}>
          <input
            type="text"
            placeholder="Search receipt #, name, roll no., or class…"
            className="mini-input"
            style={{ flex: 1, minWidth: 220 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {loaded && !loadFailed && (
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              {filtered.length} receipt{filtered.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Receipt #</th>
                <th>Student</th>
                <th>Roll</th>
                <th>Class</th>
                <th>Month</th>
                <th>Due</th>
                <th>Paid</th>
                <th>Mode</th>
                <th>Issued</th>
                <th>Issued By</th>
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                <tr>
                  <td colSpan={10} className="loading">
                    Loading…
                  </td>
                </tr>
              ) : loadFailed ? (
                <tr>
                  <td colSpan={10} className="empty">
                    Failed to load.
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="empty">
                    No receipts found.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.receipt_no}>
                    <td>
                      <strong>#{r.receipt_no}</strong>
                    </td>
                    <td>{r.student_name || '—'}</td>
                    <td>{r.roll_no ?? '—'}</td>
                    <td>
                      {r.class || ''}
                      {r.section ? '-' + r.section : ''}
                    </td>
                    <td>{monthLabel(r.academic_month)}</td>
                    <td>{formatMoney(r.amount_due)}</td>
                    <td className="amount-success">{formatMoney(r.amount_paid)}</td>
                    <td>
                      <span className={`mode-pill ${r.print_mode === 'thermal' ? 'thermal' : 'paper'}`}>
                        {r.print_mode === 'thermal' ? 'Thermal' : 'Paper'}
                      </span>
                    </td>
                    <td>{r.issued_at ? formatDate(r.issued_at) : '—'}</td>
                    <td>{r.issued_by || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <style jsx>{`
        .mode-pill {
          font-size: 11px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 10px;
        }
        .mode-pill.paper {
          background: var(--panel-2, #eef1f7);
          color: #3a4a6b;
        }
        .mode-pill.thermal {
          background: #fdeee9;
          color: #b3542b;
        }
        /* These pills use fixed light-mode pastel colors (like the app's
           other badges did before), which read fine on a light page but
           lose contrast once the background goes dark. Brighten them for
           dark mode specifically, matching .badge-info/.badge-warning in
           style.css. :global() is needed since <style jsx> is scoped to
           this component and [data-theme="dark"] lives on <html>, outside
           that scope. */
        :global([data-theme='dark']) .mode-pill.paper {
          background: #1b2e40;
          color: #8fc4f5;
        }
        :global([data-theme='dark']) .mode-pill.thermal {
          background: #3d201d;
          color: #ff9c8f;
        }
      `}</style>
    </div>
  );
}