'use client';

/**
 * app/db-admin/page.tsx
 *
 * phpMyAdmin-style DB admin viewer: table list -> row browser -> inline
 * edit/delete. Ali-only, new feature (no original HTML page to port from
 * — backend is app/api/db-admin/**, allowlisted via
 * lib/db-admin/table-registry.ts).
 *
 * Kept as a single page component with a `view` state machine (list vs
 * browse) rather than two routes, since the row browser needs no
 * deep-linkable state beyond ?table= — simpler than syncing two pages'
 * worth of loading/permission boilerplate.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthedPage from '@/components/AuthedPage';
import { api } from '@/lib/api-client';
import { showToast } from '@/lib/toast';
import { isAliUser } from '@/lib/permissions-client';

interface TableSummary {
  table: string;
  label: string;
  pk: string[];
  count: number;
}

interface Column {
  name: string;
  type: string;
  isDateOnly: boolean;
  isRequired: boolean;
  isPk: boolean;
  isReadOnly: boolean;
}

interface RowsResponse {
  table: string;
  label: string;
  columns: Column[];
  rows: Record<string, any>[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export default function DbAdminPage() {
  return (
    <AuthedPage activePage="db-admin">
      <DbAdminContent />
    </AuthedPage>
  );
}

function DbAdminContent() {
  const router = useRouter();

  // Hard guard, same pattern as app/permissions/page.tsx — this page is
  // ali-only, and the backend rejects everyone else anyway, but this
  // avoids a flash of broken/empty admin UI for anyone who lands here
  // by URL.
  useEffect(() => {
    if (!isAliUser()) {
      router.replace('/dashboard');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [view, setView] = useState<'list' | 'browse'>('list');
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [loadingTables, setLoadingTables] = useState(true);

  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [data, setData] = useState<RowsResponse | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' } | null>(null);

  const [editRow, setEditRow] = useState<Record<string, any> | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  async function loadTables() {
    setLoadingTables(true);
    try {
      const res = await api<{ tables: TableSummary[] }>('GET', '/api/db-admin/tables');
      setTables(res?.tables || []);
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setLoadingTables(false);
    }
  }

  useEffect(() => {
    loadTables();
  }, []);

  async function openTable(table: string) {
    setActiveTable(table);
    setView('browse');
    setPage(1);
    setSearch('');
    setSort(null);
    await loadRows(table, 1, '', null);
  }

  async function loadRows(
    table: string,
    pageNum: number,
    searchTerm: string,
    sortState: { field: string; dir: 'asc' | 'desc' } | null
  ) {
    setLoadingRows(true);
    try {
      const qs = new URLSearchParams({ page: String(pageNum), pageSize: '50' });
      if (searchTerm) qs.set('search', searchTerm);
      if (sortState) {
        qs.set('sort', sortState.field);
        qs.set('dir', sortState.dir);
      }
      const res = await api<RowsResponse>('GET', `/api/db-admin/tables/${table}/rows?${qs.toString()}`);
      if (res) setData(res);
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setLoadingRows(false);
    }
  }

  function backToList() {
    setView('list');
    setActiveTable(null);
    setData(null);
    loadTables(); // refresh counts, in case edits/deletes changed them
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeTable) return;
    setPage(1);
    loadRows(activeTable, 1, search, sort);
  }

  function toggleSort(field: string) {
    if (!activeTable) return;
    const next: { field: string; dir: 'asc' | 'desc' } =
      sort?.field === field ? { field, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' };
    setSort(next);
    loadRows(activeTable, page, search, next);
  }

  function changePage(newPage: number) {
    if (!activeTable || !data) return;
    if (newPage < 1 || newPage > data.totalPages) return;
    setPage(newPage);
    loadRows(activeTable, newPage, search, sort);
  }

  function openEdit(row: Record<string, any>) {
    if (!data) return;
    const values: Record<string, string> = {};
    for (const col of data.columns) {
      if (col.isReadOnly) continue;
      const v = row[col.name];
      values[col.name] = v === null || v === undefined ? '' : String(v);
    }
    setEditRow(row);
    setEditValues(values);
  }

  function closeEdit() {
    setEditRow(null);
    setEditValues({});
  }

  async function saveEdit() {
    if (!activeTable || !editRow || !data) return;
    setSavingEdit(true);
    try {
      // Only send fields that actually changed, plus always-safe empty->null.
      const payload: Record<string, any> = {};
      for (const col of data.columns) {
        if (col.isReadOnly) continue;
        const original = editRow[col.name];
        const originalStr = original === null || original === undefined ? '' : String(original);
        const next = editValues[col.name] ?? '';
        if (next !== originalStr) payload[col.name] = next === '' ? null : next;
      }
      if (Object.keys(payload).length === 0) {
        closeEdit();
        return;
      }
      await api('PUT', `/api/db-admin/tables/${activeTable}/rows/${editRow.__pk}`, payload);
      showToast('Row updated.');
      closeEdit();
      loadRows(activeTable, page, search, sort);
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteRow(row: Record<string, any>) {
    if (!activeTable) return;
    if (!confirm('Delete this row permanently? This cannot be undone.')) return;
    try {
      await api('DELETE', `/api/db-admin/tables/${activeTable}/rows/${row.__pk}`);
      showToast('Row deleted.');
      loadRows(activeTable, page, search, sort);
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  return (
    <main className="page">
      <h1 className="page-title">Database Admin Viewer</h1>

      {view === 'list' && (
        <div className="card">
          {loadingTables ? (
            <p>Loading tables…</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Table</th>
                  <th>DB Name</th>
                  <th>Rows</th>
                </tr>
              </thead>
              <tbody>
                {tables.map((t) => (
                  <tr key={t.table} onClick={() => openTable(t.table)} style={{ cursor: 'pointer' }}>
                    <td>{t.label}</td>
                    <td>
                      <code>{t.table}</code>
                    </td>
                    <td>{t.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {view === 'browse' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
            <button className="btn-secondary" onClick={backToList}>
              ← All tables
            </button>
            <h2 style={{ margin: 0 }}>
              {data?.label || activeTable} <code>({activeTable})</code>
            </h2>
            <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 8 }}>
              <input
                className="search-box"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="btn-primary" type="submit">
                Search
              </button>
            </form>
          </div>

          {loadingRows || !data ? (
            <p>Loading rows…</p>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      {data.columns.map((col) => (
                        <th
                          key={col.name}
                          onClick={() => toggleSort(col.name)}
                          style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
                          title={col.type}
                        >
                          {col.name}
                          {col.isPk ? ' 🔑' : ''}
                          {sort?.field === col.name ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </th>
                      ))}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.__pk}>
                        {data.columns.map((col) => (
                          <td key={col.name} style={{ whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {row[col.name] === null || row[col.name] === undefined ? (
                              <span style={{ color: 'var(--muted, #888)' }}>—</span>
                            ) : (
                              String(row[col.name])
                            )}
                          </td>
                        ))}
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn-secondary" onClick={() => openEdit(row)}>
                            Edit
                          </button>{' '}
                          <button className="btn-danger" onClick={() => deleteRow(row)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                    {data.rows.length === 0 && (
                      <tr>
                        <td colSpan={data.columns.length + 1}>No rows found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                <span>
                  Page {data.page} of {data.totalPages} · {data.total.toLocaleString()} rows
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-secondary" disabled={page <= 1} onClick={() => changePage(page - 1)}>
                    Prev
                  </button>
                  <button className="btn-secondary" disabled={page >= data.totalPages} onClick={() => changePage(page + 1)}>
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {editRow && data && (
        <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && closeEdit()}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">Edit row</span>
              <button className="modal-close" onClick={closeEdit}>
                ×
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '60vh', overflowY: 'auto' }}>
              {data.columns
                .filter((c) => !c.isReadOnly)
                .map((col) => (
                  <label key={col.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>
                      {col.name}
                      {col.isRequired ? ' *' : ''} <small style={{ color: 'var(--muted, #888)' }}>{col.type}</small>
                    </span>
                    <input
                      value={editValues[col.name] ?? ''}
                      onChange={(e) => setEditValues((prev) => ({ ...prev, [col.name]: e.target.value }))}
                      placeholder={col.isDateOnly ? 'YYYY-MM-DD' : ''}
                    />
                  </label>
                ))}
              {data.columns.filter((c) => c.isReadOnly).length > 0 && (
                <div style={{ fontSize: 13, color: 'var(--muted, #888)' }}>
                  Read-only: {data.columns.filter((c) => c.isReadOnly).map((c) => c.name).join(', ')}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={closeEdit}>
                Cancel
              </button>
              <button className="btn-primary" disabled={savingEdit} onClick={saveEdit}>
                {savingEdit ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
