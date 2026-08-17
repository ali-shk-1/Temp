'use client';

/**
 * app/tracking/page.tsx — direct port of frontend/tracking.html.
 * Month/Year toggle (period-switch), month view = students who paid
 * their fee that month with a table + summary cards recomputed from
 * the (possibly gender-filtered) list; year view = monthly breakdown
 * table straight from the API.
 */

import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import AuthedPage from '@/components/AuthedPage';
import Avatar from '@/components/Avatar';
import { api, dbg, formatMoney } from '@/lib/api-client';
import { loadMyPermissions, refreshMyPermissions } from '@/lib/permissions-client';
import { useLiveUpdates } from '@/lib/useLiveUpdates';

interface TrackingStudent {
  roll_no?: number | string | null;
  first_name?: string;
  last_name?: string;
  class?: string;
  section?: string;
  father_name?: string;
  academic_month?: string;
  amount_due?: number | string;
  amount_paid?: number | string;
  gender?: 'male' | 'female' | null;
  photo_url?: string | null;
}

interface YearlyRow {
  month_label: string;
  student_count: number;
  total_due: number | string;
  total_paid: number | string;
}

interface StudentYearMonthCell {
  due: number;
  paid: number;
  date: string | null;
}

interface StudentYearRow {
  student_id: number;
  roll_no?: number | string | null;
  first_name?: string;
  last_name?: string;
  father_name?: string;
  class?: string;
  section?: string;
  gender?: 'male' | 'female' | null;
  months: Record<string, StudentYearMonthCell>;
  photo_url?: string | null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function feeMonthLabel(r: TrackingStudent): string {
  if (!r.academic_month) return '—';
  const [fy, fm] = String(r.academic_month).slice(0, 7).split('-');
  return `${MONTH_NAMES[Number(fm) - 1].slice(0, 3)} ${fy}`;
}

function monthKeyLabel(key: string): string {
  const [y, m] = key.split('-');
  return `${MONTH_NAMES[Number(m) - 1].slice(0, 3)} ${y}`;
}

const nowStr = new Date().toISOString().slice(0, 10);
const currentMonthStr = nowStr.slice(0, 7);
const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);

export default function TrackingPage() {
  return (
    <AuthedPage activePage="tracking">
      <TrackingContent />
    </AuthedPage>
  );
}

function TrackingContent() {
  const [permTick, setPermTick] = useState(0);
  const [isYear, setIsYear] = useState(false);
  const [trackMode, setTrackMode] = useState<'fee' | 'student'>('student');

  const STUDENT_TRACK_SESSION_START_YEAR = 2026;
  const [studentYearRows, setStudentYearRows] = useState<StudentYearRow[]>([]);
  const [studentYearMonthKeys, setStudentYearMonthKeys] = useState<string[]>([]);
  const [studentYearLoaded, setStudentYearLoaded] = useState(false);
  const [studentYearLoadFailed, setStudentYearLoadFailed] = useState(false);
  // Top scrollbar synced to the wide yearly-track table below, so the
  // scrollbar is visible right under the section title instead of only
  // at the very bottom of a tall table (easy to miss on desktop).
  const studentYearTopScrollRef = useRef<HTMLDivElement>(null);
  const studentYearWrapRef = useRef<HTMLDivElement>(null);
  const studentYearTableRef = useRef<HTMLTableElement>(null);
  const [studentYearScrollWidth, setStudentYearScrollWidth] = useState(0);
  const syncingScrollRef = useRef<'top' | 'bottom' | null>(null);

  useEffect(() => {
    const table = studentYearTableRef.current;
    if (!table) return;
    const update = () => setStudentYearScrollWidth(table.scrollWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(table);
    return () => ro.disconnect();
  }, [studentYearMonthKeys, studentYearRows.length]);

  function handleTopScroll() {
    if (syncingScrollRef.current === 'bottom') { syncingScrollRef.current = null; return; }
    if (!studentYearTopScrollRef.current || !studentYearWrapRef.current) return;
    syncingScrollRef.current = 'top';
    studentYearWrapRef.current.scrollLeft = studentYearTopScrollRef.current.scrollLeft;
  }
  function handleBottomScroll() {
    if (syncingScrollRef.current === 'top') { syncingScrollRef.current = null; return; }
    if (!studentYearTopScrollRef.current || !studentYearWrapRef.current) return;
    syncingScrollRef.current = 'bottom';
    studentYearTopScrollRef.current.scrollLeft = studentYearWrapRef.current.scrollLeft;
  }
  const [studentTrackSearch, setStudentTrackSearch] = useState({
    roll_no: '',
    name: '',
    father_name: '',
    class: '',
    section: '',
  });
  const [studentTrackBoys, setStudentTrackBoys] = useState(false);
  const [studentTrackGirls, setStudentTrackGirls] = useState(false);

  const [monthPicker, setMonthPicker] = useState(currentMonthStr);
  const [yearPicker, setYearPicker] = useState(String(currentYear));
  const [filterBoys, setFilterBoys] = useState(false);
  const [filterGirls, setFilterGirls] = useState(false);

  const [students, setStudents] = useState<TrackingStudent[]>([]);
  const [monthLoadFailed, setMonthLoadFailed] = useState(false);
  const [monthLoaded, setMonthLoaded] = useState(false);

  const [yearRows, setYearRows] = useState<YearlyRow[]>([]);
  const [yearLoadFailed, setYearLoadFailed] = useState(false);
  const [yearLoaded, setYearLoaded] = useState(false);

  async function loadTracking() {
    if (!monthPicker) return;
    setMonthLoadFailed(false);
    try {
      const data = await api('GET', `/api/fees/tracking/monthly?month=${monthPicker}`);
      dbg('tracking monthly', data);
      setStudents((data as any)?.students || []);
      setMonthLoaded(true);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setMonthLoadFailed(true);
      setMonthLoaded(true);
    }
  }

  async function loadYearSummary() {
    setYearLoadFailed(false);
    try {
      const year = yearPicker || String(currentYear);
      const rows = await api('GET', `/api/fees/tracking/yearly?year=${year}`);
      dbg('tracking yearly', rows);
      setYearRows((rows as any) || []);
      setYearLoaded(true);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setYearLoadFailed(true);
      setYearLoaded(true);
    }
  }

  async function loadStudentYear() {
    setStudentYearLoadFailed(false);
    try {
      const data = await api('GET', `/api/fees/tracking/student-yearly?year=${STUDENT_TRACK_SESSION_START_YEAR}`);
      dbg('tracking student-yearly', data);
      setStudentYearRows((data as any)?.students || []);
      setStudentYearMonthKeys((data as any)?.month_keys || []);
      setStudentYearLoaded(true);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setStudentYearLoadFailed(true);
      setStudentYearLoaded(true);
    }
  }

  useEffect(() => {
    (async () => {
      await loadMyPermissions();
      setPermTick((n) => n + 1);
      await loadTracking();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (trackMode !== 'fee') return;
    if (!isYear) loadTracking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthPicker, isYear, trackMode]);

  useEffect(() => {
    if (trackMode !== 'fee') return;
    if (isYear) loadYearSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearPicker, isYear, trackMode]);

  useEffect(() => {
    if (trackMode === 'student') loadStudentYear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackMode]);

  useLiveUpdates({
    'fees.changed': () => {
      if (trackMode === 'student') {
        loadStudentYear();
        return;
      }
      if (isYear) loadYearSummary();
      else loadTracking();
    },
    'permissions.changed': () => refreshMyPermissions(() => setPermTick((n) => n + 1)),
  });

  const filteredStudents = useMemo(() => {
    const wantBoys = filterBoys,
      wantGirls = filterGirls;
    if (wantBoys !== wantGirls) {
      return students.filter((s) => (wantBoys && s.gender === 'male') || (wantGirls && s.gender === 'female'));
    }
    return students;
  }, [students, filterBoys, filterGirls]);

  const totals = useMemo(() => {
    const t = filteredStudents.reduce(
      (acc, s) => {
        acc.total_paid += Number(s.amount_paid) || 0;
        acc.total_due += Number(s.amount_due) || 0;
        return acc;
      },
      { total_paid: 0, total_due: 0 }
    );
    return { ...t, total_balance: t.total_due - t.total_paid };
  }, [filteredStudents]);

  const trackTableTitle = useMemo(() => {
    const [y, m] = monthPicker.split('-');
    if (!y || !m) return 'Students Who Paid Their Fee';
    return `Students Who Paid Their Fee In ${MONTH_NAMES[Number(m) - 1]} ${y}`;
  }, [monthPicker]);

  // Deferred: the Student Yearly Track grid is by far the heaviest
  // table in the app (12 months x 3 sub-columns per student, plus a
  // frozen-column layout), so this is the table where un-deferred
  // typing would feel the most "stuck". Deferring keeps every
  // keystroke in the filter boxes instant.
  const deferredStudentTrackSearch = useDeferredValue(studentTrackSearch);

  const filteredStudentYearRows = useMemo(() => {
    const roll = deferredStudentTrackSearch.roll_no.trim().toLowerCase();
    const name = deferredStudentTrackSearch.name.trim().toLowerCase();
    const father = deferredStudentTrackSearch.father_name.trim().toLowerCase();
    const cls = deferredStudentTrackSearch.class.trim().toLowerCase();
    const sec = deferredStudentTrackSearch.section.trim().toLowerCase();
    const wantBoys = studentTrackBoys,
      wantGirls = studentTrackGirls;
    const genderFilterActive = wantBoys !== wantGirls;
    if (!roll && !name && !father && !cls && !sec && !genderFilterActive) return studentYearRows;
    return studentYearRows.filter((s) => {
      const fullName = `${s.first_name || ''} ${s.last_name || ''}`.toLowerCase();
      if (roll && !String(s.roll_no ?? '').toLowerCase().includes(roll)) return false;
      if (name && !fullName.includes(name)) return false;
      if (father && !(s.father_name || '').toLowerCase().includes(father)) return false;
      if (cls && !String(s.class ?? '').toLowerCase().includes(cls)) return false;
      if (sec && !String(s.section ?? '').toLowerCase().includes(sec)) return false;
      if (genderFilterActive && !((wantBoys && s.gender === 'male') || (wantGirls && s.gender === 'female'))) return false;
      return true;
    });
  }, [studentYearRows, deferredStudentTrackSearch, studentTrackBoys, studentTrackGirls]);

  function setCurrentMonth() {
    setMonthPicker(currentMonthStr);
  }

  function onPeriodToggle(checked: boolean) {
    setIsYear(checked);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{trackMode === 'fee' ? 'Fee Tracking' : 'Student Tracking'}</h1>
        <div className="period-switch">
          <span className={`period-label${trackMode === 'student' ? ' inactive' : ''}`}>Fee Tracking</span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={trackMode === 'student'}
              onChange={(e) => setTrackMode(e.target.checked ? 'student' : 'fee')}
            />
            <span className="toggle-slider"></span>
          </label>
          <span className={`period-label${trackMode === 'fee' ? ' inactive' : ''}`}>Student Tracking</span>
        </div>
      </div>

      {trackMode === 'fee' && (
      <>
      <div className="page-header -mt-1">
        <span />
        <div className="period-switch">
          <span className={`period-label${isYear ? ' inactive' : ''}`}>Month</span>
          <label className="toggle-switch">
            <input type="checkbox" checked={isYear} onChange={(e) => onPeriodToggle(e.target.checked)} />
            <span className="toggle-slider"></span>
          </label>
          <span className={`period-label${!isYear ? ' inactive' : ''}`}>Year</span>
        </div>
      </div>

      <div className="card mb-3">
        {!isYear ? (
          <div className="filters">
            <label className="text-muted text-xs">
              Month:
            </label>
            <input type="month" value={monthPicker} onChange={(e) => setMonthPicker(e.target.value)} />
            <button className="btn btn-outline btn-sm" onClick={setCurrentMonth}>
              This Month
            </button>
            <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
              <input type="checkbox" checked={filterBoys} onChange={(e) => setFilterBoys(e.target.checked)} /> Boys
            </label>
            <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
              <input type="checkbox" checked={filterGirls} onChange={(e) => setFilterGirls(e.target.checked)} /> Girls
            </label>
          </div>
        ) : (
          <div className="filters">
            <label className="text-muted text-xs">
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

      {!isYear ? (
        <div>
          <div className="card mb-3">
            <div className="tracking-summary">
              <div className="block">
                <div className="big amount-success">{formatMoney(totals.total_paid)}</div>
                <div className="small">Fee Paid</div>
              </div>
              <div className="block">
                <div className="big text-base">
                  {formatMoney(totals.total_due)}
                </div>
                <div className="small">Fee Due</div>
              </div>
              <div className="block">
                <div className="big amount-danger text-base">
                  {formatMoney(totals.total_balance)}
                </div>
                <div className="small">Balance Due</div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-title">{trackTableTitle}</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Photo</th>
                    <th>Roll No</th>
                    <th>Full Name</th>
                    <th>Class</th>
                    <th>Sec</th>
                    <th>Father Name</th>
                    <th>Fee Month</th>
                    <th>Fee (Due)</th>
                    <th>Fee (Paid)</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {!monthLoaded ? (
                    <tr>
                      <td colSpan={11} className="loading">
                        Loading…
                      </td>
                    </tr>
                  ) : monthLoadFailed ? (
                    <tr>
                      <td colSpan={11} className="empty">
                        Failed to load.
                      </td>
                    </tr>
                  ) : filteredStudents.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="empty">
                        No fee payments recorded for this month.
                      </td>
                    </tr>
                  ) : (
                    filteredStudents.map((s, i) => {
                      const balance = (Number(s.amount_due) || 0) - (Number(s.amount_paid) || 0);
                      return (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td>
                            <Avatar src={s.photo_url} name={`${s.first_name || ''} ${s.last_name || ''}`} />
                          </td>
                          <td>{s.roll_no ?? '—'}</td>
                          <td>
                            {s.first_name || ''} {s.last_name || ''}
                          </td>
                          <td>{s.class ?? '—'}</td>
                          <td>{s.section ?? '—'}</td>
                          <td>{s.father_name || '—'}</td>
                          <td>
                            <span className="badge badge-info">{feeMonthLabel(s)}</span>
                          </td>
                          <td>{formatMoney(s.amount_due)}</td>
                          <td className="amount-success">{formatMoney(s.amount_paid)}</td>
                          <td className={balance > 0 ? 'amount-danger' : ''}>{formatMoney(balance)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="card">
            <div className="section-title">Monthly Breakdown</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Students</th>
                    <th>Fee Due</th>
                    <th>Fee Paid</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {!yearLoaded ? (
                    <tr>
                      <td colSpan={5} className="loading">
                        Loading…
                      </td>
                    </tr>
                  ) : yearLoadFailed ? (
                    <tr>
                      <td colSpan={5} className="empty">
                        Failed to load.
                      </td>
                    </tr>
                  ) : yearRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty">
                        No data for this year.
                      </td>
                    </tr>
                  ) : (
                    yearRows.map((r, i) => {
                      const balance = (Number(r.total_due) || 0) - (Number(r.total_paid) || 0);
                      return (
                        <tr key={i}>
                          <td>{r.month_label}</td>
                          <td>{r.student_count}</td>
                          <td>{formatMoney(r.total_due)}</td>
                          <td className="amount-success">{formatMoney(r.total_paid)}</td>
                          <td className={balance > 0 ? 'amount-danger' : ''}>{formatMoney(balance)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      </>
      )}

      {trackMode === 'student' && (
        <div>
          <div className="card mb-3">
            <div className="filters student-track-filters">
              <label className="text-muted text-xs">
                Session: Apr {STUDENT_TRACK_SESSION_START_YEAR} – Mar {STUDENT_TRACK_SESSION_START_YEAR + 1}
              </label>
              <input
                type="text"
                placeholder="Roll No"
                value={studentTrackSearch.roll_no}
                onChange={(e) => setStudentTrackSearch({ ...studentTrackSearch, roll_no: e.target.value })}
                className="w-[90px]"
              />
              <input
                type="text"
                placeholder="Name"
                value={studentTrackSearch.name}
                onChange={(e) => setStudentTrackSearch({ ...studentTrackSearch, name: e.target.value })}
                className="w-[140px]"
              />
              <input
                type="text"
                placeholder="Father Name"
                value={studentTrackSearch.father_name}
                onChange={(e) => setStudentTrackSearch({ ...studentTrackSearch, father_name: e.target.value })}
                className="w-[140px]"
              />
              <input
                type="text"
                placeholder="Class"
                value={studentTrackSearch.class}
                onChange={(e) => setStudentTrackSearch({ ...studentTrackSearch, class: e.target.value })}
                className="w-20"
              />
              <input
                type="text"
                placeholder="Sec"
                value={studentTrackSearch.section}
                onChange={(e) => setStudentTrackSearch({ ...studentTrackSearch, section: e.target.value })}
                className="w-[70px]"
              />
              <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
                <input type="checkbox" checked={studentTrackBoys} onChange={(e) => setStudentTrackBoys(e.target.checked)} /> Boys
              </label>
              <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
                <input type="checkbox" checked={studentTrackGirls} onChange={(e) => setStudentTrackGirls(e.target.checked)} /> Girls
              </label>
              {(studentTrackSearch.roll_no || studentTrackSearch.name || studentTrackSearch.father_name || studentTrackSearch.class || studentTrackSearch.section || studentTrackBoys || studentTrackGirls) && (
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    setStudentTrackSearch({ roll_no: '', name: '', father_name: '', class: '', section: '' });
                    setStudentTrackBoys(false);
                    setStudentTrackGirls(false);
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="card">
            <div className="section-title">Student Yearly Track</div>
            <div
              className="student-year-top-scroll"
              ref={studentYearTopScrollRef}
              onScroll={handleTopScroll}
            >
              <div style={{ width: studentYearScrollWidth, height: 1 }} />
            </div>
            <div
              className="table-wrap student-year-wrap"
              ref={studentYearWrapRef}
              onScroll={handleBottomScroll}
            >
              <table className="student-year-table" ref={studentYearTableRef}>
                <thead>
                  <tr>
                    <th rowSpan={2}>Sr #</th>
                    <th rowSpan={2} className="frozen-col frozen-col-1">Photo</th>
                    <th rowSpan={2} className="frozen-col frozen-col-2">Roll No</th>
                    <th rowSpan={2} className="frozen-col frozen-col-3">Name</th>
                    <th rowSpan={2} className="father-name-col">Father Name</th>
                    <th rowSpan={2} className="frozen-col frozen-col-4">Class</th>
                    <th rowSpan={2}>Sec</th>
                    {studentYearMonthKeys.map((key) => (
                      <th key={key} colSpan={3} className="month-group-head">
                        {monthKeyLabel(key)}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {studentYearMonthKeys.map((key) => (
                      <Fragment key={key}>
                        <th className="sub-col">Date</th>
                        <th className="sub-col">Due</th>
                        <th className="sub-col">Paid</th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!studentYearLoaded ? (
                    <tr>
                      <td colSpan={7 + studentYearMonthKeys.length * 3} className="loading">
                        Loading…
                      </td>
                    </tr>
                  ) : studentYearLoadFailed ? (
                    <tr>
                      <td colSpan={7 + studentYearMonthKeys.length * 3} className="empty">
                        Failed to load.
                      </td>
                    </tr>
                  ) : filteredStudentYearRows.length === 0 ? (
                    <tr>
                      <td colSpan={7 + studentYearMonthKeys.length * 3} className="empty">
                        No students found.
                      </td>
                    </tr>
                  ) : (
                    filteredStudentYearRows.map((s, i) => (
                      <tr key={s.student_id}>
                        <td>{i + 1}</td>
                        <td className="frozen-col frozen-col-1">
                          <Avatar src={s.photo_url} name={`${s.first_name || ''} ${s.last_name || ''}`} size={28} />
                        </td>
                        <td className="frozen-col frozen-col-2">{s.roll_no ?? '—'}</td>
                        <td className="frozen-col frozen-col-3">
                          {s.first_name || ''} {s.last_name || ''}
                        </td>
                        <td className="father-name-col">{s.father_name || '—'}</td>
                        <td className="frozen-col frozen-col-4">{s.class ?? '—'}</td>
                        <td>{s.section ?? '—'}</td>
                        {studentYearMonthKeys.map((key) => {
                          const cell = s.months[key] || { due: 0, paid: 0, date: null };
                          const isShort = cell.due > 0 && cell.paid < cell.due;
                          return (
                            <Fragment key={key}>
                              <td className="sub-col">
                                {cell.date ? cell.date.slice(8, 10) + '/' + cell.date.slice(5, 7) : '—'}
                              </td>
                              <td className="sub-col">{cell.due ? formatMoney(cell.due) : '—'}</td>
                              <td className={`sub-col${isShort ? ' amount-danger' : ''}`}>
                                {cell.due > 0 ? formatMoney(cell.paid) : '—'}
                              </td>
                            </Fragment>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .period-switch {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .period-switch :global(.toggle-switch) {
          width: 44px;
          height: 24px;
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
        .tracking-summary {
          display: flex;
          flex-wrap: wrap;
          gap: 24px;
          align-items: baseline;
        }
        .tracking-summary .big {
          font-size: 26px;
          font-weight: 700;
          color: var(--text);
        }
        .tracking-summary .small {
          font-size: 12px;
          color: var(--muted);
          margin-top: 2px;
        }
        .tracking-summary .block {
          min-width: 120px;
        }
        .student-year-table {
          border-collapse: collapse;
          white-space: nowrap;
        }
        .student-year-table th,
        .student-year-table td {
          padding: 6px 8px;
          font-size: 12px;
          text-align: center;
        }
        .student-year-table .month-group-head {
          border-left: 2px solid var(--border, #e2e2e2);
          background: var(--th-bg);
          color: var(--th-text);
        }
        .student-year-table .sub-col {
          border-left: 1px solid var(--border, #eee);
          min-width: 52px;
        }
        .student-year-top-scroll {
          overflow-x: auto;
          overflow-y: hidden;
          height: 14px;
          margin-bottom: 2px;
          scrollbar-width: thin;
          scrollbar-color: var(--accent, #4f46e5) var(--panel-2, rgba(127,127,127,0.08));
        }
        .student-year-top-scroll::-webkit-scrollbar {
          height: 12px;
        }
        .student-year-top-scroll::-webkit-scrollbar-track {
          background: var(--panel-2, rgba(127,127,127,0.08));
          border-radius: 8px;
        }
        .student-year-top-scroll::-webkit-scrollbar-thumb {
          background: var(--accent, #4f46e5);
          border-radius: 8px;
          border: 3px solid transparent;
          background-clip: padding-box;
        }
        .student-year-top-scroll::-webkit-scrollbar-thumb:hover {
          background: var(--accent-hover, #4338ca);
          background-clip: padding-box;
        }
        .student-year-wrap {
          overflow-x: auto;
          position: relative;
          /* Firefox */
          scrollbar-width: thin;
          scrollbar-color: var(--muted) transparent;
          padding-bottom: 4px;
        }
        /* Chrome/Edge/Safari — a persistently visible, styled horizontal
           scrollbar so the table is obviously draggable with a mouse
           (not just via trackpad/touch swipe). */
        .student-year-wrap::-webkit-scrollbar {
          height: 12px;
        }
        .student-year-wrap::-webkit-scrollbar-track {
          background: var(--panel-2, rgba(127,127,127,0.08));
          border-radius: 8px;
        }
        .student-year-wrap::-webkit-scrollbar-thumb {
          background: var(--muted);
          border-radius: 8px;
          border: 3px solid transparent;
          background-clip: padding-box;
        }
        .student-year-wrap::-webkit-scrollbar-thumb:hover {
          background: var(--accent);
          background-clip: padding-box;
        }
        .student-year-table .frozen-col {
          position: sticky;
          background: var(--card-bg, #fff);
          z-index: 2;
        }
        .student-year-table thead .frozen-col {
          z-index: 3;
          background: var(--th-bg);
          color: var(--th-text);
        }
        .student-year-table .frozen-col-1 { left: 0; min-width: 44px; }
        .student-year-table .frozen-col-2 { left: 44px; min-width: 70px; }
        .student-year-table .frozen-col-3 { left: 114px; min-width: 150px; text-align: left; }
        .student-year-table .father-name-col { min-width: 150px; text-align: left; }
        .student-year-table .frozen-col-4 {
          left: 264px;
          min-width: 60px;
          border-right: 2px solid var(--border, #e2e2e2);
        }
        .student-track-filters {
          flex-wrap: wrap;
          row-gap: 8px;
        }
      `}</style>
    </div>
  );
}
