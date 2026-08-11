'use client';

/**
 * app/staff/page.tsx — direct port of frontend/staff.html.
 * Same Staff modal (add/edit) + Designations modal, same search/designation
 * filter, same leave/edit/delete confirm() flows and permission gating.
 */

import { useEffect, useMemo, useState } from 'react';
import AuthedPage from '@/components/AuthedPage';
import { api, formatMoney, normalizeList } from '@/lib/api-client';
import { showToast } from '@/lib/toast';
import { hasPerm, loadMyPermissions, refreshMyPermissions } from '@/lib/permissions-client';
import { useLiveUpdates } from '@/lib/useLiveUpdates';

interface Staff {
  staff_id: number;
  name: string;
  cnic: string;
  phone_no: string | null;
  salary: number | null;
  designation_id: number | null;
  designation_title: string | null;
}

interface Designation {
  id: number;
  title: string;
}

const emptyForm = {
  staff_id: '' as string | number,
  name: '',
  cnic: '',
  phone: '',
  salary: '',
  designationId: '',
};

export default function StaffPage() {
  return (
    <AuthedPage activePage="staff">
      <StaffContent />
    </AuthedPage>
  );
}

function StaffContent() {
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  const [search, setSearch] = useState('');
  const [filterDesig, setFilterDesig] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });

  const [desigModalOpen, setDesigModalOpen] = useState(false);
  const [newDesigTitle, setNewDesigTitle] = useState('');

  const [permTick, setPermTick] = useState(0); // bump to re-render after permissions change

  async function loadDesignations() {
    try {
      const res = await api('GET', '/api/staff/designations');
      const list = normalizeList<Designation>(res, ['designations', 'data']);
      setDesignations(list);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    }
  }

  async function loadStaff() {
    try {
      const res = await api('GET', '/api/staff');
      const list = normalizeList<Staff>(res, ['staff', 'data']);
      setAllStaff(list);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }

  useEffect(() => {
    (async () => {
      await loadMyPermissions();
      setPermTick((n) => n + 1);
      await loadDesignations();
      await loadStaff();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLiveUpdates({
    'staff.changed': () => loadStaff(),
    'designations.changed': () => loadDesignations(),
    'permissions.changed': () => refreshMyPermissions(() => setPermTick((n) => n + 1)),
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return allStaff.filter((s) => {
      const txt = `${s.name} ${s.cnic}`.toLowerCase();
      return (!q || txt.includes(q)) && (!filterDesig || String(s.designation_id) === filterDesig);
    });
  }, [allStaff, search, filterDesig]);

  function openModal(staff: Staff | null = null) {
    setForm({
      staff_id: staff ? staff.staff_id : '',
      name: staff ? staff.name : '',
      cnic: staff ? staff.cnic : '',
      phone: staff ? staff.phone_no || '' : '',
      salary: staff ? String(staff.salary ?? '') : '',
      designationId: staff ? String(staff.designation_id ?? '') : '',
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function editStaff(id: number) {
    const s = allStaff.find((x) => x.staff_id === id);
    if (s) openModal(s);
  }

  async function saveStaff() {
    const id = form.staff_id;
    const body = {
      name: form.name.trim(),
      cnic: form.cnic.trim(),
      phone_no: form.phone.trim(),
      salary: parseFloat(form.salary) || 0,
      designation_id: parseInt(form.designationId, 10) || null,
    };
    if (!body.name || !body.cnic) {
      showToast('Name and CNIC are required.', 'error');
      return;
    }
    try {
      if (id) {
        await api('PUT', `/api/staff/${id}`, body);
        showToast('Staff updated.');
      } else {
        await api('POST', '/api/staff', body);
        showToast('Staff added.');
      }
      closeModal();
      loadStaff();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  async function deleteStaff(id: number) {
    const s = allStaff.find((x) => x.staff_id === id);
    if (!confirm(`Delete "${s ? s.name : 'this staff member'}"? This cannot be undone.`)) return;
    try {
      await api('DELETE', `/api/staff/${id}`);
      showToast('Staff deleted.');
      loadStaff();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  async function leaveStaffMember(id: number) {
    const s = allStaff.find((x) => x.staff_id === id);
    const name = s ? s.name : 'this staff member';
    if (!confirm(`Mark "${name}" as left? Their record moves to Left Staff.`)) return;
    try {
      await api('POST', `/api/staff/${id}/leave`, { left_reason: 'Left employment' });
      showToast('Staff member moved to left staff records.');
      loadStaff();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  // Designations management
  function openDesigModal() {
    setDesigModalOpen(true);
  }

  function closeDesigModal() {
    setDesigModalOpen(false);
    loadDesignations();
  }

  async function addDesignation() {
    const title = newDesigTitle.trim();
    if (!title) return;
    try {
      await api('POST', '/api/staff/designations', { title });
      setNewDesigTitle('');
      const dRaw = await api('GET', '/api/staff/designations');
      setDesignations(normalizeList<Designation>(dRaw, ['designations', 'data']));
      showToast('Designation added.');
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  async function deleteDesig(id: number, title: string) {
    if (!confirm(`Remove designation "${title}"?`)) return;
    try {
      await api('DELETE', `/api/staff/designations/${id}`);
      const dRaw = await api('GET', '/api/staff/designations');
      setDesignations(normalizeList<Designation>(dRaw, ['designations', 'data']));
      showToast('Designation removed.');
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  return (
    <>
      {/* Staff Modal */}
      <div className={`modal-overlay${modalOpen ? ' open' : ''}`}>
        <div className="modal">
          <div className="modal-header">
            <h2 className="modal-title">{form.staff_id ? 'Edit Staff Member' : 'Add Staff Member'}</h2>
            <button className="modal-close" onClick={closeModal}>
              ×
            </button>
          </div>
          <form onSubmit={(e) => e.preventDefault()}>
            <div className="form-row">
              <div className="form-group" style={{ gridColumn: '1/-1' }}>
                <label>Full Name *</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group" style={{ flex: '1 1 100%' }}>
                <label>CNIC *</label>
                <input
                  type="text"
                  placeholder="xxxxx-xxxxxxx-x"
                  required
                  value={form.cnic}
                  onChange={(e) => setForm({ ...form, cnic: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Phone</label>
                <input
                  type="text"
                  placeholder="03xxxxxxxxx"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Salary (Rs.)</label>
                <input
                  type="number"
                  placeholder="0.00"
                  step="0.01"
                  value={form.salary}
                  onChange={(e) => setForm({ ...form, salary: e.target.value })}
                />
              </div>
            </div>
            <div className="form-group">
              <label>Designation</label>
              <select
                value={form.designationId}
                onChange={(e) => setForm({ ...form, designationId: e.target.value })}
              >
                <option value="">Select designation</option>
                {designations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={closeModal}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={saveStaff}>
                Save
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Designation Modal */}
      <div className={`modal-overlay${desigModalOpen ? ' open' : ''}`}>
        <div className="modal" style={{ maxWidth: 380 }}>
          <div className="modal-header">
            <h2 className="modal-title">Manage Designations</h2>
            <button className="modal-close" onClick={closeDesigModal}>
              ×
            </button>
          </div>
          {hasPerm('staff.designations') && (
            <div className="form-group">
              <label>Add New Designation</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="e.g. Teacher"
                  style={{ flex: 1, padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
                  value={newDesigTitle}
                  onChange={(e) => setNewDesigTitle(e.target.value)}
                />
                <button className="btn btn-primary" onClick={addDesignation}>
                  Add
                </button>
              </div>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            {designations.length === 0 ? (
              <p className="empty">No designations yet.</p>
            ) : (
              <div style={{ border: '1px solid #eee', borderRadius: 4 }}>
                {designations.map((d, i) => (
                  <div
                    key={d.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderTop: i ? '1px solid #eee' : undefined,
                    }}
                  >
                    <span>{d.title}</span>
                    {hasPerm('staff.designations') && (
                      <button className="btn btn-danger btn-sm" onClick={() => deleteDesig(d.id, d.title)}>
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
          <h1 className="page-title">Staff</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            {hasPerm('staff.designations') && (
              <button className="btn btn-outline" onClick={openDesigModal}>
                Designations
              </button>
            )}
            {hasPerm('staff.add') && (
              <button className="btn btn-primary" onClick={() => openModal()}>
                + Add Staff
              </button>
            )}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="filters">
            <input
              className="search-box"
              type="text"
              placeholder="Search name or CNIC…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select value={filterDesig} onChange={(e) => setFilterDesig(e.target.value)}>
              <option value="">All Designations</option>
              {designations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#555', marginLeft: 'auto' }}>
              {filtered.length} staff member{filtered.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Designation</th>
                  <th>CNIC</th>
                  <th>Phone</th>
                  <th>Salary</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadFailed ? (
                  <tr>
                    <td colSpan={7} className="empty">
                      Failed to load.
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="empty">
                      No staff found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((s, i) => (
                    <tr key={s.staff_id}>
                      <td>{i + 1}</td>
                      <td>
                        <strong>{s.name}</strong>
                      </td>
                      <td>{s.designation_title || '—'}</td>
                      <td>{s.cnic}</td>
                      <td>{s.phone_no || '—'}</td>
                      <td>{formatMoney(s.salary ?? 0)}</td>
                      <td>
                        {hasPerm('staff.edit') && (
                          <button className="btn btn-outline btn-sm" onClick={() => editStaff(s.staff_id)}>
                            Edit
                          </button>
                        )}
                        {hasPerm('staff.leave') && (
                          <button className="btn btn-warning btn-sm" onClick={() => leaveStaffMember(s.staff_id)}>
                            Leave
                          </button>
                        )}
                        {hasPerm('staff.delete') && (
                          <button className="btn btn-danger btn-sm" onClick={() => deleteStaff(s.staff_id)}>
                            Delete
                          </button>
                        )}
                        {!hasPerm('staff.edit') && !hasPerm('staff.leave') && !hasPerm('staff.delete') && '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
