'use client';

/**
 * app/staff/page.tsx — direct port of frontend/staff.html.
 * Same Staff modal (add/edit) + Designations modal, same search/designation
 * filter, same leave/edit/delete confirm() flows and permission gating.
 */

import { useEffect, useDeferredValue, useMemo, useRef, useState } from 'react';
import AuthedPage from '@/components/AuthedPage';
import { api, apiForm, formatMoney, formatDate, normalizeList } from '@/lib/api-client';
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
  photo_url: string | null;
  joining_date: string | null;
  category: 'category_1' | 'category_2' | null;
  admin_id: number | null;
  admin_name: string | null;
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
  joining_date: '',
  category: '',
  adminId: '',
  photo_url: '',
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
  const [filterAdmin, setFilterAdmin] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const photoFileInputRef = useRef<HTMLInputElement>(null);

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

  const adminCandidates = useMemo(
    () => allStaff.filter((s) => (s.designation_title || '').toLowerCase().includes('admin')),
    [allStaff],
  );

  const deferredSearch = useDeferredValue(search);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return allStaff.filter((s) => {
      // Case-insensitive across name, CNIC, designation, and admin name —
      // so typing "hassan" matches Hassan himself AND anyone whose
      // admin_name is "Hassan" (i.e. staff reporting to him).
      const txt = `${s.name} ${s.cnic} ${s.designation_title || ''} ${s.admin_name || ''}`.toLowerCase();
      const matchesDesig = !filterDesig || String(s.designation_id) === filterDesig;
      const matchesAdmin =
        !filterAdmin || (filterAdmin === 'none' ? !s.admin_id : String(s.admin_id) === filterAdmin);
      return (!q || txt.includes(q)) && matchesDesig && matchesAdmin;
    });
  }, [allStaff, deferredSearch, filterDesig, filterAdmin]);

  function setPhotoPreviewFor(src: string) {
    setPhotoPreview(src);
  }

  function openModal(staff: Staff | null = null) {
    setForm({
      staff_id: staff ? staff.staff_id : '',
      name: staff ? staff.name : '',
      cnic: staff ? staff.cnic : '',
      phone: staff ? staff.phone_no || '' : '',
      salary: staff ? String(staff.salary ?? '') : '',
      designationId: staff ? String(staff.designation_id ?? '') : '',
      joining_date: staff ? staff.joining_date || '' : '',
      category: staff ? staff.category || '' : '',
      adminId: staff ? String(staff.admin_id ?? '') : '',
      photo_url: staff ? staff.photo_url || '' : '',
    });
    setPhotoFile(null);
    if (photoFileInputRef.current) photoFileInputRef.current.value = '';
    setPhotoPreviewFor(staff ? staff.photo_url || '' : '');
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setPhotoFile(null);
    if (photoFileInputRef.current) photoFileInputRef.current.value = '';
    setPhotoPreviewFor('');
  }

  function previewSelectedPhoto(file: File | null) {
    setPhotoFile(file);
    if (!file) {
      setPhotoPreviewFor(form.photo_url.trim());
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhotoPreviewFor(String(reader.result));
    reader.readAsDataURL(file);
  }

  function editStaff(id: number) {
    const s = allStaff.find((x) => x.staff_id === id);
    if (s) openModal(s);
  }

  async function saveStaff() {
    const id = form.staff_id;
    const body: any = {
      name: form.name.trim(),
      cnic: form.cnic.trim(),
      phone_no: form.phone.trim(),
      salary: parseFloat(form.salary) || 0,
      designation_id: parseInt(form.designationId, 10) || null,
      joining_date: form.joining_date || null,
      category: form.category || null,
      admin_id: form.adminId ? parseInt(form.adminId, 10) : null,
      photo_url: photoFile ? null : form.photo_url.trim() || null,
    };
    if (!body.name || !body.cnic) {
      showToast('Name and CNIC are required.', 'error');
      return;
    }
    try {
      let savedStaff: any = null;

      if (id) {
        if (photoFile) {
          const formData = new FormData();
          formData.append('cnic', body.cnic);
          formData.append('photo', photoFile);
          const upload: any = await apiForm('/api/staff/upload-photo', formData);
          body.photo_url = upload.url;
        }
        const res: any = await api('PUT', `/api/staff/${id}`, body);
        savedStaff = res.staff;
        showToast('Staff updated.');
      } else {
        const staffRes: any = await api('POST', '/api/staff', body);
        savedStaff = staffRes.staff;
        if (photoFile) {
          const uploadForm = new FormData();
          uploadForm.append('cnic', staffRes.staff.cnic);
          uploadForm.append('photo', photoFile);
          const upload: any = await apiForm('/api/staff/upload-photo', uploadForm);
          await api('PUT', `/api/staff/${staffRes.staff.staff_id}`, { ...body, photo_url: upload.url });
        }
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
              <div className="form-group [grid-column:1/-1]">
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
              <div className="form-group flex-[1_1_100%]">
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
            <div className="form-row">
              <div className="form-group">
                <label>Joining Date</label>
                <input
                  type="date"
                  value={form.joining_date}
                  onChange={(e) => setForm({ ...form, joining_date: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="">Select category</option>
                  <option value="category_1">Category 1</option>
                  <option value="category_2">Category 2</option>
                </select>
              </div>
            </div>
            <div className="form-row">
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
              <div className="form-group">
                <label>Under Admin</label>
                <select value={form.adminId} onChange={(e) => setForm({ ...form, adminId: e.target.value })}>
                  <option value="">None</option>
                  {adminCandidates
                    .filter((a) => String(a.staff_id) !== String(form.staff_id))
                    .map((a) => (
                      <option key={a.staff_id} value={a.staff_id}>
                        {a.name} ({a.designation_title})
                      </option>
                    ))}
                </select>
                <small className="text-secondary block mt-1">
                  Optional. Assign this staff member as reporting to another staff member with an Admin designation.
                </small>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group w-full">
                <label>Upload Photo</label>
                <input
                  ref={photoFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => previewSelectedPhoto(e.target.files?.[0] || null)}
                />
                <small className="text-secondary block mt-1">
                  Saved as uploads/staff/&lt;CNIC&gt;.ext — replaces any existing photo for this CNIC.
                </small>
              </div>
            </div>
            <div className={`form-row ${photoPreview ? 'flex' : 'hidden'}`}>
              <div className="form-group w-full">
                <label>Photo Preview</label>
                <div className="border border-[#ccc] rounded-lg overflow-hidden w-40 h-40 flex items-center justify-center bg-input-bg">
                  {photoPreview && (
                    <img src={photoPreview} alt="Photo preview" className="max-w-full max-h-full block" />
                  )}
                </div>
              </div>
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
        <div className="modal max-w-[380px]">
          <div className="modal-header">
            <h2 className="modal-title">Manage Designations</h2>
            <button className="modal-close" onClick={closeDesigModal}>
              ×
            </button>
          </div>
          {hasPerm('staff.designations') && (
            <div className="form-group">
              <label>Add New Designation</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. Teacher"
                  className="border-input flex-1 p-2 rounded"
                  value={newDesigTitle}
                  onChange={(e) => setNewDesigTitle(e.target.value)}
                />
                <button className="btn btn-primary" onClick={addDesignation}>
                  Add
                </button>
              </div>
            </div>
          )}
          <div className="mt-3">
            {designations.length === 0 ? (
              <p className="empty">No designations yet.</p>
            ) : (
              <div className="border-subtle rounded">
                {designations.map((d, i) => (
                  <div
                    key={d.id}
                    className={`flex items-center justify-between px-3 py-2 ${i ? 'border-t border-[#eee]' : ''}`}
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
          <div className="flex gap-2">
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

        <div className="card mb-4">
          <div className="filters">
            <input
              className="search-box"
              type="text"
              placeholder="Search name, CNIC, designation, or admin…"
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
            <select value={filterAdmin} onChange={(e) => setFilterAdmin(e.target.value)}>
              <option value="">All Staff (Any/No Admin)</option>
              <option value="none">Not Under Any Admin</option>
              {adminCandidates.map((a) => (
                <option key={a.staff_id} value={a.staff_id}>
                  Under {a.name}
                </option>
              ))}
            </select>
            <span className="text-secondary text-sm font-semibold ml-auto">
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
                  <th>Photo</th>
                  <th>Name</th>
                  <th>Designation</th>
                  <th>CNIC</th>
                  <th>Phone</th>
                  <th>Salary</th>
                  <th>Joining Date</th>
                  <th>Category</th>
                  <th>Under Admin</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadFailed ? (
                  <tr>
                    <td colSpan={11} className="empty">
                      Failed to load.
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="empty">
                      No staff found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((s, i) => (
                    <tr key={s.staff_id}>
                      <td>{i + 1}</td>
                      <td>
                        {s.photo_url ? (
                          <img
                            src={s.photo_url}
                            alt={s.name}
                            className="w-8 h-8 rounded-full object-cover block"
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <strong>{s.name}</strong>
                      </td>
                      <td>{s.designation_title || '—'}</td>
                      <td>{s.cnic}</td>
                      <td>{s.phone_no || '—'}</td>
                      <td>{formatMoney(s.salary ?? 0)}</td>
                      <td>{s.joining_date ? formatDate(s.joining_date) : '—'}</td>
                      <td>{s.category === 'category_1' ? 'Category 1' : s.category === 'category_2' ? 'Category 2' : '—'}</td>
                      <td>{s.admin_name || '—'}</td>
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
