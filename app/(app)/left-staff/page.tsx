'use client';

/**
 * app/left-staff/page.tsx — direct port of frontend/left-staff.html.
 * Edit-only modal, delete with confirm(), permission-gated buttons.
 */

import { useEffect, useState } from 'react';
import AuthedPage from '@/components/AuthedPage';
import { api, formatDate, formatMoney, normalizeList } from '@/lib/api-client';
import { showToast } from '@/lib/toast';
import { hasPerm, loadMyPermissions, refreshMyPermissions } from '@/lib/permissions-client';
import { useLiveUpdates } from '@/lib/useLiveUpdates';

interface LeftStaff {
  left_staff_id: number;
  name: string;
  cnic: string | null;
  phone_no: string | null;
  salary: number | null;
  designation: string | null;
  left_date: string | null;
  left_reason: string | null;
}

const emptyForm = {
  left_staff_id: '' as string | number,
  name: '',
  cnic: '',
  phone: '',
  salary: '',
  designation: '',
  leftDate: '',
  reason: '',
};

export default function LeftStaffPage() {
  return (
    <AuthedPage activePage="left-staff">
      <LeftStaffContent />
    </AuthedPage>
  );
}

function LeftStaffContent() {
  const [allLeftStaff, setAllLeftStaff] = useState<LeftStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });

  const [permTick, setPermTick] = useState(0); // bump to re-render after permissions change

  async function loadLeftStaff() {
    setLoading(true);
    try {
      const res = await api('GET', '/api/staff/left');
      const list = normalizeList<LeftStaff>(res, ['former_staff', 'staff', 'data']);
      setAllLeftStaff(list);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      await loadMyPermissions();
      await loadLeftStaff();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLiveUpdates({
    'left-staff.changed': () => loadLeftStaff(),
    'permissions.changed': () => refreshMyPermissions(() => setPermTick((n) => n + 1)),
  });

  function editLeftStaff(id: number) {
    const s = allLeftStaff.find((x) => x.left_staff_id === id);
    if (!s) return;
    setForm({
      left_staff_id: s.left_staff_id,
      name: s.name || '',
      cnic: s.cnic || '',
      phone: s.phone_no || '',
      salary: s.salary ? String(s.salary) : '',
      designation: s.designation || '',
      leftDate: s.left_date ? s.left_date.slice(0, 10) : '',
      reason: s.left_reason || '',
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  async function saveLeftStaff() {
    const id = form.left_staff_id;
    const body = {
      name: form.name.trim(),
      cnic: form.cnic.trim(),
      phone_no: form.phone.trim(),
      salary: parseFloat(form.salary) || 0,
      designation: form.designation.trim(),
      left_date: form.leftDate || null,
      left_reason: form.reason.trim(),
    };
    if (!body.name) {
      showToast('Name is required.', 'error');
      return;
    }
    try {
      await api('PUT', `/api/staff/left/${id}`, body);
      showToast('Left staff record updated.');
      closeModal();
      loadLeftStaff();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  async function deleteLeftStaff(id: number) {
    const s = allLeftStaff.find((x) => x.left_staff_id === id);
    if (!confirm(`Delete left-staff record for "${s ? s.name : 'this person'}"? This cannot be undone.`)) return;
    try {
      await api('DELETE', `/api/staff/left/${id}`);
      showToast('Left staff record deleted.');
      loadLeftStaff();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  return (
    <>
      {/* Edit Left Staff Modal */}
      <div className={`modal-overlay${modalOpen ? ' open' : ''}`}>
        <div className="modal">
          <div className="modal-header">
            <h2 className="modal-title">Edit Left Staff Record</h2>
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
              <div className="form-group">
                <label>CNIC</label>
                <input
                  type="text"
                  placeholder="xxxxx-xxxxxxx-x"
                  value={form.cnic}
                  onChange={(e) => setForm({ ...form, cnic: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input
                  type="text"
                  placeholder="03xxxxxxxxx"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
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
              <div className="form-group">
                <label>Designation</label>
                <input
                  type="text"
                  placeholder="e.g. Teacher"
                  value={form.designation}
                  onChange={(e) => setForm({ ...form, designation: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Left Date</label>
                <input
                  type="date"
                  value={form.leftDate}
                  onChange={(e) => setForm({ ...form, leftDate: e.target.value })}
                />
              </div>
            </div>
            <div className="form-group">
              <label>Reason</label>
              <input
                type="text"
                placeholder="Reason for leaving"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={closeModal}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={saveLeftStaff}>
                Save
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Left Staff</h1>
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
                  <th>Left Date</th>
                  <th>Reason</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="loading">
                      Loading…
                    </td>
                  </tr>
                ) : loadFailed ? (
                  <tr>
                    <td colSpan={9} className="empty">
                      Failed to load left staff.
                    </td>
                  </tr>
                ) : allLeftStaff.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="empty">
                      No left staff found.
                    </td>
                  </tr>
                ) : (
                  allLeftStaff.map((s, i) => (
                    <tr key={s.left_staff_id}>
                      <td>{i + 1}</td>
                      <td>
                        <strong>{s.name}</strong>
                      </td>
                      <td>{s.designation || '—'}</td>
                      <td>{s.cnic || '—'}</td>
                      <td>{s.phone_no || '—'}</td>
                      <td>{formatMoney(s.salary ?? 0)}</td>
                      <td>{formatDate(s.left_date)}</td>
                      <td>{s.left_reason || '—'}</td>
                      <td>
                        {hasPerm('left-staff.edit') && (
                          <button className="btn btn-outline btn-sm" onClick={() => editLeftStaff(s.left_staff_id)}>
                            Edit
                          </button>
                        )}
                        {hasPerm('left-staff.delete') && (
                          <button className="btn btn-danger btn-sm" onClick={() => deleteLeftStaff(s.left_staff_id)}>
                            Delete
                          </button>
                        )}
                        {!hasPerm('left-staff.edit') && !hasPerm('left-staff.delete') && '—'}
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
