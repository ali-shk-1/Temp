'use client';

/**
 * app/students/page.tsx — direct port of frontend/students.html.
 * Same modal-based add/edit form, same profile view modal, same photo
 * upload (file takes precedence over URL, same field-order-before-file
 * multipart contract), same filters, same leave/delete confirm() flows.
 */

import { useEffect, useDeferredValue, useMemo, useRef, useState } from 'react';
import AuthedPage from '@/components/AuthedPage';
import Avatar from '@/components/Avatar';
import { api, apiForm, dbg, formatDate, normalizeList } from '@/lib/api-client';
import { showToast } from '@/lib/toast';
import { hasPerm, loadMyPermissions, refreshMyPermissions } from '@/lib/permissions-client';
import { useLiveUpdates } from '@/lib/useLiveUpdates';
import { bindPanelKeyboardNavigation } from '@/lib/api-client';

interface Student {
  student_id: number;
  first_name: string;
  last_name: string | null;
  roll_no: number | null;
  class: string;
  section: string;
  gender: 'male' | 'female' | null;
  father_name: string | null;
  admission_date: string | null;
  fee_start_month: string | null;
  contact_1: string | null;
  contact_2: string | null;
  email: string | null;
  photo_url: string | null;
  address: string | null;
}

function makeEmptyForm() {
  return {
    student_id: '' as string | number,
    first_name: '',
    last_name: '',
    roll_no: '',
    class: '',
    section: '',
    gender: '',
    father_name: '',
    admission_date: new Date().toISOString().slice(0, 10),
    fee_start_month: '',
    contact_1: '',
    contact_2: '',
    email: '',
    photo_url: '',
    address: '',
  };
}

export default function StudentsPage() {
  return (
    <AuthedPage activePage="students">
      <StudentsContent />
    </AuthedPage>
  );
}

function StudentsContent() {
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [search, setSearch] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [filterBoys, setFilterBoys] = useState(false);
  const [filterGirls, setFilterGirls] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(() => makeEmptyForm());
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const photoFileInputRef = useRef<HTMLInputElement>(null);

  const [profileOpen, setProfileOpen] = useState(false);
  const [profileStudent, setProfileStudent] = useState<Student | null>(null);

  const [permTick, setPermTick] = useState(0); // bump to re-render after permissions change
  const formRef = useRef<HTMLFormElement>(null);

  async function loadStudents() {
    setLoading(true);
    try {
      const res = await api('GET', '/api/students');
      dbg('students raw', res);
      const list = normalizeList<Student>(res, ['students', 'data']);
      setAllStudents(list);
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
      setPermTick((n) => n + 1);
      await loadStudents();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (formRef.current) {
      return bindPanelKeyboardNavigation(formRef.current);
    }
  }, [modalOpen]);

  useLiveUpdates({
    'students.changed': () => loadStudents(),
    'permissions.changed': () => refreshMyPermissions(() => setPermTick((n) => n + 1)),
  });

  // Deferred copies of the text filters: typing updates the input
  // instantly (search/filterClass/filterSection stay in sync with each
  // keystroke so the box never feels laggy), while the expensive
  // filter+re-render of the whole table trails a frame behind via
  // React's scheduler. This is what stops "type -> table freezes for a
  // moment -> results appear" — the input itself never blocks.
  const deferredSearch = useDeferredValue(search);
  const deferredFilterClass = useDeferredValue(filterClass);
  const deferredFilterSection = useDeferredValue(filterSection);

  const filtered = useMemo(() => {
    const q = deferredSearch.toLowerCase();
    const clsQ = deferredFilterClass.trim().toLowerCase();
    const secQ = deferredFilterSection.trim().toLowerCase();
    const wantBoys = filterBoys;
    const wantGirls = filterGirls;
    const genderNarrowed = wantBoys !== wantGirls;
    return allStudents.filter((s) => {
      const name = `${s.first_name} ${s.last_name} ${s.roll_no}`.toLowerCase();
      return (
        (!q || name.includes(q)) &&
        (!clsQ || (s.class || '').toLowerCase().includes(clsQ)) &&
        (!secQ || (s.section || '').toLowerCase().includes(secQ)) &&
        (!genderNarrowed || (wantBoys && s.gender === 'male') || (wantGirls && s.gender === 'female'))
      );
    });
  }, [allStudents, deferredSearch, deferredFilterClass, deferredFilterSection, filterBoys, filterGirls]);

  function setPhotoPreviewFor(src: string) {
    setPhotoPreview(src);
  }

  function openModal(student: Student | null = null) {
    setForm({
      student_id: student ? student.student_id : '',
      first_name: student ? student.first_name : '',
      last_name: student ? student.last_name || '' : '',
      roll_no: student ? String(student.roll_no ?? '') : '',
      class: student ? student.class : '',
      section: student ? student.section : '',
      gender: student ? student.gender || '' : '',
      father_name: student ? student.father_name || '' : '',
      admission_date: student ? (student.admission_date ? student.admission_date.slice(0, 10) : '') : new Date().toISOString().slice(0, 10),
      fee_start_month: student ? (student.fee_start_month ? student.fee_start_month.slice(0, 7) : '') : '',
      contact_1: student ? student.contact_1 || '' : '',
      contact_2: student ? student.contact_2 || '' : '',
      email: student ? student.email || '' : '',
      photo_url: student ? student.photo_url || '' : '',
      address: student ? student.address || '' : '',
    });
    setPhotoFile(null);
    if (photoFileInputRef.current) photoFileInputRef.current.value = '';
    setPhotoPreviewFor(student ? student.photo_url || '' : '');
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setPhotoFile(null);
    if (photoFileInputRef.current) photoFileInputRef.current.value = '';
    setPhotoPreviewFor('');
  }

  function viewStudent(id: number) {
    const s = allStudents.find((x) => x.student_id === id);
    if (!s) return;
    setProfileStudent(s);
    setProfileOpen(true);
  }

  function closeProfileModal() {
    setProfileOpen(false);
    setProfileStudent(null);
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

  function editStudent(id: number) {
    const s = allStudents.find((x) => x.student_id === id);
    if (s) openModal(s);
  }

  async function saveStudent() {
    const id = form.student_id;
    const body = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      roll_no: form.roll_no ? parseInt(form.roll_no, 10) : null,
      class: form.class.trim(),
      section: form.section.trim(),
      gender: form.gender || null,
      father_name: form.father_name.trim(),
      admission_date: form.admission_date || null,
      fee_start_month: form.fee_start_month ? `${form.fee_start_month}-01` : null,
      contact_1: form.contact_1.trim(),
      contact_2: form.contact_2.trim(),
      email: form.email.trim() || null,
      photo_url: form.photo_url.trim() || null,
      address: form.address.trim(),
    };

    if (!body.first_name || !body.class || !body.section) {
      showToast('Please fill all required fields.', 'error');
      return;
    }
    if (!/^[A-Za-z]$/.test(body.section) && !/^[A-Za-z]+-[A-Za-z]$/.test(body.section)) {
      showToast('Section must be a single letter (A, B, C) or a stream + letter like Csc-A, Bio-B, Arts-A.', 'error');
      return;
    }
    if (!body.gender) {
      showToast('Please select a gender.', 'error');
      return;
    }

    try {
      const createBody: any = {
        ...body,
        photo_url: photoFile ? null : body.photo_url,
      };

      if (id) {
        if (photoFile) {
          const formData = new FormData();
          // NOTE: text fields must be appended BEFORE the file field.
          // multer/busboy streams multipart fields in the order they
          // arrive, and our dynamic destination() function (which sorts
          // photos into uploads/<gender>/<class>/<section>/<roll_no>.ext)
          // needs class/section/roll_no/gender already parsed from
          // req.body by the time it runs for the photo part.
          formData.append('first_name', body.first_name);
          formData.append('class', body.class);
          formData.append('section', body.section);
          formData.append('roll_no', String(body.roll_no || ''));
          formData.append('gender', body.gender || '');
          formData.append('photo', photoFile);
          const upload: any = await apiForm('/api/students/upload-photo', formData);
          body.photo_url = upload.url;
        }

        await api('PUT', `/api/students/${id}`, body);
        showToast('Student updated.', 'success');
      } else {
        const studentRes: any = await api('POST', '/api/students', createBody);
        if (photoFile) {
          const uploadForm = new FormData();
          uploadForm.append('first_name', studentRes.student.first_name);
          uploadForm.append('class', studentRes.student.class);
          uploadForm.append('section', studentRes.student.section);
          uploadForm.append('roll_no', String(studentRes.student.roll_no || ''));
          uploadForm.append('gender', studentRes.student.gender || '');
          uploadForm.append('photo', photoFile);
          const upload: any = await apiForm('/api/students/upload-photo', uploadForm);
          await api('PUT', `/api/students/${studentRes.student.student_id}`, { ...body, photo_url: upload.url });
        }

        showToast('Student added.', 'success');
      }
      closeModal();
      loadStudents();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  async function deleteStudent(id: number) {
    const s = allStudents.find((x) => x.student_id === id);
    const name = s ? `${s.first_name} ${s.last_name}` : 'this student';
    if (!confirm(`Delete student "${name}"? This cannot be undone.`)) return;
    try {
      await api('DELETE', `/api/students/${id}`);
      showToast('Student deleted.');
      loadStudents();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  async function leaveStudent(id: number) {
    const s = allStudents.find((x) => x.student_id === id);
    const name = s ? `${s.first_name} ${s.last_name}` : 'this student';
    if (!confirm(`Mark student "${name}" as left the school?`)) return;
    try {
      await api('POST', `/api/students/${id}/leave`, { left_reason: 'Left school' });
      showToast('Student moved to left students records.', 'success');
      loadStudents();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  return (
    <>
      {/* Add/Edit Modal */}
      <div className={`modal-overlay${modalOpen ? ' open' : ''}`}>
        <div className="modal">
          <div className="modal-header">
            <h2 className="modal-title">{form.student_id ? 'Edit Student' : 'Add Student'}</h2>
            <button className="modal-close" onClick={closeModal}>
              ×
            </button>
          </div>
          <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
            <div className="form-row">
              <div className="form-group">
                <label>First Name *</label>
                <input
                  type="text"
                  required
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Last Name</label>
                <input
                  type="text"
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Roll No</label>
                <input
                  type="number"
                  placeholder="Leave blank for auto assign"
                  value={form.roll_no}
                  onChange={(e) => setForm({ ...form, roll_no: e.target.value })}
                />
                <small className="text-secondary block mt-1">
                  If no roll number is entered, the system assigns the next available number within this class,
                  section, and gender (each combination has its own independent numbering).
                </small>
              </div>
              <div className="form-group">
                <label>Class *</label>
                <input
                  type="text"
                  required
                  placeholder="playgroup, nursery, prep or 1-10"
                  value={form.class}
                  onChange={(e) => setForm({ ...form, class: e.target.value })}
                />
                <small className="text-secondary block mt-1">
                  Enter a valid class name. Only playgroup, nursery, prep, and 1 through 10 are accepted.
                </small>
              </div>
              <div className="form-group">
                <label>Section *</label>
                <input
                  type="text"
                  placeholder="A, B, C or Csc-A, Bio-B, Arts-A"
                  maxLength={10}
                  value={form.section}
                  onChange={(e) => setForm({ ...form, section: e.target.value })}
                />
                <small className="text-secondary block mt-1">
                  Enter a single letter (A, B, C) or a stream name + letter (e.g. Csc-A, Bio-B, Arts-A).
                </small>
              </div>
              <div className="form-group">
                <label>Gender *</label>
                <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                  <option value="" disabled>Select gender…</option>
                  <option value="male">Boy</option>
                  <option value="female">Girl</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Father's Name</label>
                <input
                  type="text"
                  value={form.father_name}
                  onChange={(e) => setForm({ ...form, father_name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Admission Date</label>
                <input
                  type="date"
                  value={form.admission_date}
                  onChange={(e) => setForm({ ...form, admission_date: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Fee Start Month</label>
                <input
                  type="month"
                  value={form.fee_start_month}
                  onChange={(e) => setForm({ ...form, fee_start_month: e.target.value })}
                />
                <small className="text-secondary block mt-1">
                  Use Month-YYYY to control when fee billing begins. Leave blank to use admission month.
                </small>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Contact 1</label>
                <input
                  type="text"
                  placeholder="03xx-xxxxxxx or 03xxxxxxxxx"
                  value={form.contact_1}
                  onChange={(e) => setForm({ ...form, contact_1: e.target.value })}
                />
                <small className="text-secondary block mt-1">
                  Mobile (03xx-xxxxxxx) or landline (051-xxxxxxx). Dashes optional — saved in this format automatically.
                </small>
              </div>
              <div className="form-group">
                <label>Contact 2</label>
                <input
                  type="text"
                  placeholder="Optional"
                  value={form.contact_2}
                  onChange={(e) => setForm({ ...form, contact_2: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  placeholder="student@example.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Photo URL</label>
                <input
                  type="url"
                  placeholder="https://example.com/photo.jpg"
                  value={form.photo_url}
                  onChange={(e) => {
                    setForm({ ...form, photo_url: e.target.value });
                    if (!photoFile) setPhotoPreviewFor(e.target.value.trim());
                  }}
                />
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
                  If you choose a file, it will be uploaded and used instead of the Photo URL.
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
            <div className="form-group">
              <label>Address</label>
              <textarea
                rows={2}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={closeModal}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={saveStudent}>
                Save Student
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Profile Modal */}
      <div className={`modal-overlay${profileOpen ? ' open' : ''}`}>
        <div className="modal">
          <div className="modal-header">
            <h2 className="modal-title">Student Profile</h2>
            <button className="modal-close" onClick={closeProfileModal}>
              ×
            </button>
          </div>
          <div className="profile-card">
            <div className="profile-photo">
              {profileStudent?.photo_url && (
                <img
                  src={profileStudent.photo_url}
                  alt="Student photo"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
            </div>
            <div className="profile-details">
              <div>
                <strong>
                  {profileStudent ? `${profileStudent.first_name} ${profileStudent.last_name || ''}` : ''}
                </strong>
              </div>
              <div>Class / Section: {profileStudent ? `${profileStudent.class || '—'} ${profileStudent.section || ''}` : ''}</div>
              <div>
                Gender:{' '}
                {profileStudent
                  ? profileStudent.gender === 'male'
                    ? 'Boy'
                    : profileStudent.gender === 'female'
                    ? 'Girl'
                    : '—'
                  : ''}
              </div>
              <div>Roll No: {profileStudent?.roll_no || '—'}</div>
              <div>Father: {profileStudent?.father_name || '—'}</div>
              <div>Contact: {profileStudent?.contact_1 || '—'}</div>
              <div>Email: {profileStudent?.email || '—'}</div>
              <div className="whitespace-pre-wrap mt-2">Address: {profileStudent?.address || '—'}</div>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-outline" onClick={closeProfileModal}>
              Close
            </button>
          </div>
        </div>
      </div>

      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Students</h1>
          <div className="flex gap-2.5 items-center">
            {hasPerm('students.add') && (
              <button className="btn btn-primary transition-transform duration-150 active:scale-95" onClick={() => openModal()}>
                + Add Student
              </button>
            )}
          </div>
        </div>

        <div className="card mb-4">
          <div className="filters">
            <input
              className="search-box"
              type="text"
              placeholder="Search name, roll no…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <input
              className="search-box max-w-[220px]"
              type="text"
              placeholder="Filter by class"
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
            />
            <input
              className="search-box max-w-[160px]"
              type="text"
              placeholder="Filter by section"
              value={filterSection}
              onChange={(e) => setFilterSection(e.target.value)}
            />
            <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
              <input type="checkbox" checked={filterBoys} onChange={(e) => setFilterBoys(e.target.checked)} /> Boys
            </label>
            <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
              <input type="checkbox" checked={filterGirls} onChange={(e) => setFilterGirls(e.target.checked)} /> Girls
            </label>
            <span className="text-secondary text-sm font-semibold ml-auto">
              {filtered.length} student{filtered.length !== 1 ? 's' : ''}
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
                  <th>Roll No</th>
                  <th>Name</th>
                  <th>Class</th>
                  <th>Section</th>
                  <th>Gender</th>
                  <th>Father</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>Admitted</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={12} className="loading">
                      Loading…
                    </td>
                  </tr>
                ) : loadFailed ? (
                  <tr>
                    <td colSpan={12} className="empty">
                      Failed to load students.
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="empty">
                      No students found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((s, i) => (
                    <tr key={s.student_id}>
                      <td>{i + 1}</td>
                      <td>
                        <Avatar src={s.photo_url} name={`${s.first_name} ${s.last_name || ''}`} />
                      </td>
                      <td>{s.roll_no}</td>
                      <td>
                        <strong>
                          {s.first_name} {s.last_name}
                        </strong>
                      </td>
                      <td>{s.class}</td>
                      <td>{s.section}</td>
                      <td>{s.gender === 'male' ? 'Boy' : s.gender === 'female' ? 'Girl' : '—'}</td>
                      <td>{s.father_name || '—'}</td>
                      <td>{s.contact_1 || '—'}</td>
                      <td>{s.email || '—'}</td>
                      <td className="text-muted text-xs">
                        {s.admission_date ? formatDate(s.admission_date) : '—'}
                      </td>
                      <td>
                        <button className="btn btn-outline btn-sm" onClick={() => viewStudent(s.student_id)}>
                          View
                        </button>
                        {hasPerm('students.edit') && (
                          <button className="btn btn-outline btn-sm" onClick={() => editStudent(s.student_id)}>
                            Edit
                          </button>
                        )}
                        {hasPerm('students.leave') && (
                          <button className="btn btn-warning btn-sm" onClick={() => leaveStudent(s.student_id)}>
                            Leave
                          </button>
                        )}
                        {hasPerm('students.delete') && (
                          <button className="btn btn-danger btn-sm" onClick={() => deleteStudent(s.student_id)}>
                            Delete
                          </button>
                        )}
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