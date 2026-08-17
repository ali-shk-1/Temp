'use client';

/**
 * app/fees/page.tsx — direct port of frontend/fees.html.
 *
 * Same four tabs (Monthly Records / Daily Collections / Monthly
 * Defaulters / Student History), same Record Payment + edit-existing
 * modal, same paper/thermal receipt printing (two full inline HTML
 * documents opened in a new tab, same markup/CSS as the original —
 * this is intentional: the receipt is printed from its own window, not
 * rendered as part of the app UI), same `?action=record-payment` query
 * contract (dashboard's "Record Fee" button links here).
 *
 * Permissions (fees.add / fees.edit / fees.delete / fees.custom_date)
 * read from the shared permissions-client cache, same as the original's
 * hasPerm() calls.
 */

import { Fragment, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AuthedPage from '@/components/AuthedPage';
import Avatar from '@/components/Avatar';
import { api, apiForm as _apiForm, bindPanelKeyboardNavigation, dbg, formatDate, formatMoney, normalizeList } from '@/lib/api-client';
import { showToast } from '@/lib/toast';
import { hasPerm, loadMyPermissions, refreshMyPermissions } from '@/lib/permissions-client';
import { useLiveUpdates } from '@/lib/useLiveUpdates';

// ---- Types (shapes match what the API routes return, per api/fees/*) ----
interface StudentLite {
  student_id: number;
  first_name: string;
  last_name: string | null;
  roll_no: number | null;
  class: string;
  section: string;
  gender: 'male' | 'female' | null;
  father_name?: string | null;
  contact_1?: string | null;
  photo_url?: string | null;
}

interface FeeRow {
  payment_id?: number;
  receipt_no?: number | string;
  student_id: number;
  first_name: string;
  last_name: string | null;
  roll_no: number | null;
  class: string;
  section: string;
  gender: 'male' | 'female' | null;
  academic_month: string;
  amount_due: number | string;
  amount_paid: number | string;
  balance?: number | string;
  payment_date?: string | null;
  contact_1?: string | null;
  father_name?: string | null;
  photo_url?: string | null;
  this_payment_amount?: number | string;
}

interface ReceiptData {
  receipt_no: number | string;
  roll_no: number | string;
  student_name: string;
  class_section: string;
  father_name: string;
  contact_1: string;
  photo_url: string;
  academic_month: string;
  amount_due: number;
  amount_paid: number;
  balance: number;
  payment_date: Date;
  total_fee: number | null;
  discount: number | null;
}

interface ClassFeeRow {
  class_fee_id: number;
  class: string;
  total_fee: number | string;
  updated_at?: string;
  updated_by?: string | null;
}

// Canonical class list for the Total Fee settings page — playgroup/
// prep/nursery come first (as taught), then grades 1-10. students.class
// is free text in the DB, so this is just the standard set offered in
// the "Add" dropdown; any class actually in use can still be added.
const CLASS_LIST = [
  'Playgroup', 'Nursery', 'Prep',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
];

const SCHOOL_NAME = 'AL Siddeeq Model High School Rawalpindi';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Parses 'YYYY-MM-DD'/'YYYY-MM' directly into "Month YYYY" without ever
// constructing `new Date(...)` — that path is timezone-sensitive and can
// silently shift the displayed month backward by one.
function monthLabel(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const m = String(dateStr).match(/^(\d{4})-(\d{2})/);
  if (!m) return '—';
  const [, year, month] = m;
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

function fmtDateTime(dt: Date): string {
  const datePart = dt.toLocaleDateString('en-GB');
  const timePart = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${datePart}, ${timePart}`;
}

function getPrintMode(): 'paper' | 'thermal' {
  if (typeof window === 'undefined') return 'paper';
  return localStorage.getItem('feePrintMode') === 'thermal' ? 'thermal' : 'paper';
}
function setPrintModeStorage(mode: 'paper' | 'thermal') {
  localStorage.setItem('feePrintMode', mode === 'thermal' ? 'thermal' : 'paper');
}

function groupDefaultersByMonth(data: FeeRow[]) {
  const groups: Record<string, FeeRow[]> = {};
  data.forEach((r) => {
    const key = String(r.academic_month || '').slice(0, 10);
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });
  return Object.keys(groups)
    .sort((a, b) => b.localeCompare(a))
    .map((key) => ({ academic_month: key, count: groups[key].length, defaulters: groups[key] }));
}

const todayStr = new Date().toISOString().slice(0, 10);
const monthStr = new Date().toISOString().slice(0, 7);

export default function FeesPage() {
  return (
    <AuthedPage activePage="fees">
      <Suspense fallback={null}>
        <FeesContent />
      </Suspense>
    </AuthedPage>
  );
}

function FeesContent() {
  const searchParams = useSearchParams();

  const [permTick, setPermTick] = useState(0);
  const canAddFees = () => hasPerm('fees.add');
  const canEditFees = () => hasPerm('fees.edit');
  const canDeleteFees = () => hasPerm('fees.delete');
  const canCustomDateFees = () => hasPerm('fees.custom_date');

  const canAddClassFees = () => hasPerm('class-fees.add');
  const canEditClassFees = () => hasPerm('class-fees.edit');
  const canDeleteClassFees = () => hasPerm('class-fees.delete');

  const [allStudents, setAllStudents] = useState<StudentLite[]>([]);

  const [tab, setTab] = useState<'monthly' | 'daily' | 'monthly-defaulters' | 'history' | 'total-fee'>('monthly');

  // ---- Stats ----
  const [statCollected, setStatCollected] = useState('—');
  const [statDefaulters, setStatDefaulters] = useState<string | number>('—');
  const [statToday, setStatToday] = useState('—');

  // ---- Monthly tab ----
  const [monthFilter, setMonthFilter] = useState(monthStr);
  const [classFilter, setClassFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [feeFilterBoys, setFeeFilterBoys] = useState(false);
  const [feeFilterGirls, setFeeFilterGirls] = useState(false);
  const [feeSearch, setFeeSearch] = useState('');
  const [monthlyData, setMonthlyData] = useState<FeeRow[]>([]);
  const [monthlyLoadFailed, setMonthlyLoadFailed] = useState(false);

  // ---- Daily tab ----
  const [dailyDateFilter, setDailyDateFilter] = useState(todayStr);
  const [dailyFilterBoys, setDailyFilterBoys] = useState(false);
  const [dailyFilterGirls, setDailyFilterGirls] = useState(false);
  const [dailyList, setDailyList] = useState<FeeRow[]>([]);
  const [dailyLoadFailed, setDailyLoadFailed] = useState(false);
  const [dailyLoaded, setDailyLoaded] = useState(false);

  // ---- Monthly defaulters tab ----
  const [defMonthFilter, setDefMonthFilter] = useState(monthStr);
  const [defFilterBoys, setDefFilterBoys] = useState(false);
  const [defFilterGirls, setDefFilterGirls] = useState(false);
  const [defSearch, setDefSearch] = useState('');
  const [defaultersList, setDefaultersList] = useState<FeeRow[]>([]);
  const [defaultersLoadFailed, setDefaultersLoadFailed] = useState(false);
  const [defaultersLoaded, setDefaultersLoaded] = useState(false);

  // ---- History tab ----
  const [historySearch, setHistorySearch] = useState('');
  const [historyResultsOpen, setHistoryResultsOpen] = useState(false);
  const [historyStudentId, setHistoryStudentId] = useState<number | null>(null);
  const [historyList, setHistoryList] = useState<FeeRow[]>([]);
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const historyWrapRef = useRef<HTMLDivElement>(null);

  // ---- Total Fee tab (global per-class fee settings) ----
  const [classFees, setClassFees] = useState<ClassFeeRow[]>([]);
  const [classFeesLoaded, setClassFeesLoaded] = useState(false);
  const [classFeesLoadFailed, setClassFeesLoadFailed] = useState(false);
  const [newFeeClass, setNewFeeClass] = useState('');
  const [newFeeAmount, setNewFeeAmount] = useState('');
  const [editingClassFeeId, setEditingClassFeeId] = useState<number | null>(null);
  const [editingClassFeeAmount, setEditingClassFeeAmount] = useState('');

  // ---- Print mode toggle ----
  const [thermalMode, setThermalMode] = useState(false);

  // ---- Payment modal ----
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payModalTitle, setPayModalTitle] = useState('Record Fee Payment');
  const [paySaveLabel, setPaySaveLabel] = useState('Record Payment');
  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null);
  const [payStudentSearch, setPayStudentSearch] = useState('');
  const [payStudentSel, setPayStudentSel] = useState<number | ''>('');
  const [payResultsOpen, setPayResultsOpen] = useState(false);
  const [payStudentDisabled, setPayStudentDisabled] = useState(false);
  const [payMonth, setPayMonth] = useState(monthStr);
  const [payMonthDisabled, setPayMonthDisabled] = useState(false);
  const [payDue, setPayDue] = useState('');
  const [payPaid, setPayPaid] = useState('');
  const [existingPayInfo, setExistingPayInfo] = useState('');
  const [showCustomDateGroup, setShowCustomDateGroup] = useState(false);
  const [useCustomDate, setUseCustomDate] = useState(false);
  const [customDate, setCustomDate] = useState(todayStr);
  const payWrapRef = useRef<HTMLDivElement>(null);
  const payFormRef = useRef<HTMLFormElement>(null);

  // ---- Receipt modal ----
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);

  async function loadStudents() {
    try {
      const res = await api('GET', '/api/students');
      const list = normalizeList<StudentLite>(res, ['students', 'data']);
      list.sort((a, b) => a.class.localeCompare(b.class) || (a.roll_no ?? 0) - (b.roll_no ?? 0));
      setAllStudents(list);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    }
  }

  async function loadStats(month = monthFilter) {
    try {
      const [feeSum, todayFees, monthlyDefaultersRes] = await Promise.all([
        api('GET', `/api/fees/summary/monthly?month=${month}-01`),
        api('GET', `/api/fees/daily?date=${todayStr}`),
        api('GET', `/api/fees/monthly-defaulters?month=${month}-01`),
      ]);

      setStatCollected(formatMoney((feeSum as any)?.total_paid || 0));

      const defList = normalizeList<FeeRow>(monthlyDefaultersRes, ['defaulters']);
      const defaulterCount =
        (monthlyDefaultersRes as any)?.total_overdue_months ??
        defList.reduce((sum, r: any) => sum + (+r.overdue_months || 0), 0);
      setStatDefaulters(defaulterCount);

      const todayTotal = normalizeList<FeeRow>(todayFees, ['payments', 'data']).reduce(
        (s, r) => s + (+r.amount_paid || 0),
        0
      );
      setStatToday(formatMoney(todayTotal));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('loadStats error:', e);
    }
  }

  async function loadMonthlyRecords() {
    setMonthlyLoadFailed(false);
    try {
      let url = `/api/fees?month=${monthFilter}-01`;
      if (classFilter) url += `&class=${classFilter}`;
      const raw = await api('GET', url);
      dbg('fees monthly raw', raw);
      setMonthlyData(normalizeList<FeeRow>(raw, ['fees', 'payments', 'data']));
      loadStats();
    } catch {
      setMonthlyLoadFailed(true);
    }
  }

  async function loadDailyRecords() {
    setDailyLoadFailed(false);
    try {
      const raw = await api('GET', `/api/fees/daily?date=${dailyDateFilter}`);
      setDailyList(normalizeList<FeeRow>(raw, ['payments', 'data']));
      setDailyLoaded(true);
    } catch {
      setDailyLoadFailed(true);
      setDailyLoaded(true);
    }
  }

  async function loadMonthlyDefaulters() {
    setDefaultersLoadFailed(false);
    try {
      const raw = await api('GET', `/api/fees/monthly-defaulters?month=${defMonthFilter}-01`);
      setDefaultersList(normalizeList<FeeRow>(raw, ['defaulters', 'data']));
      setDefaultersLoaded(true);
    } catch {
      setDefaultersLoadFailed(true);
      setDefaultersLoaded(true);
    }
  }

  async function loadStudentHistory(id: number | null) {
    if (!id) return;
    setHistoryLoadFailed(false);
    try {
      const res = await api('GET', `/api/fees/student/${id}`);
      dbg('student history raw', res);
      const data = normalizeList<FeeRow>(res, ['payments', 'fees', 'data']);
      setHistoryList(data);
      setHistoryLoaded(true);
    } catch {
      setHistoryLoadFailed(true);
      setHistoryLoaded(true);
    }
  }

  async function loadClassFees() {
    setClassFeesLoadFailed(false);
    try {
      const raw = await api('GET', '/api/class-fees');
      setClassFees(normalizeList<ClassFeeRow>(raw, ['class_fees', 'data']));
      setClassFeesLoaded(true);
    } catch {
      setClassFeesLoadFailed(true);
      setClassFeesLoaded(true);
    }
  }

  async function addClassFee() {
    const cls = newFeeClass.trim();
    const amount = parseFloat(newFeeAmount);
    if (!cls) {
      showToast('Select a class.', 'error');
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      showToast('Enter a valid total fee amount.', 'error');
      return;
    }
    try {
      await api('POST', '/api/class-fees', { class: cls, total_fee: amount });
      showToast('Total fee saved.', 'success');
      setNewFeeClass('');
      setNewFeeAmount('');
      loadClassFees();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  function startEditClassFee(row: ClassFeeRow) {
    setEditingClassFeeId(row.class_fee_id);
    setEditingClassFeeAmount(String(row.total_fee));
  }
  function cancelEditClassFee() {
    setEditingClassFeeId(null);
    setEditingClassFeeAmount('');
  }
  async function saveEditClassFee(id: number) {
    const amount = parseFloat(editingClassFeeAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      showToast('Enter a valid total fee amount.', 'error');
      return;
    }
    try {
      await api('PUT', `/api/class-fees/${id}`, { total_fee: amount });
      showToast('Total fee updated.', 'success');
      cancelEditClassFee();
      loadClassFees();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }
  async function deleteClassFee(id: number) {
    if (!confirm('Delete the total fee record for this class?')) return;
    try {
      await api('DELETE', `/api/class-fees/${id}`);
      showToast('Total fee record deleted.', 'success');
      loadClassFees();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  // Classes not yet configured — offered in the "Add" dropdown.
  const availableClassesToAdd = useMemo(() => {
    const used = new Set(classFees.map((c) => c.class));
    return CLASS_LIST.filter((c) => !used.has(c));
  }, [classFees]);

  // class_section is stored as e.g. "5-A" / "Nursery-A" — strip the
  // trailing "-<section>" to get the plain class label for lookups.
  function baseClassFromSection(classSection: string): string {
    return classSection.replace(/-[^-]*$/, '');
  }

  useEffect(() => {
    (async () => {
      const isThermal = getPrintMode() === 'thermal';
      setThermalMode(isThermal);
      await loadMyPermissions();
      setPermTick((n) => n + 1);
      await loadStudents();
      await loadMonthlyRecords();
      loadStats();
      loadClassFees();

      const action = searchParams.get('action');
      if (action === 'record-payment' && hasPerm('fees.add')) {
        openPayModal();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadMonthlyRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthFilter, classFilter]);

  useEffect(() => {
    if (tab === 'daily') loadDailyRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, dailyDateFilter]);

  useEffect(() => {
    if (tab === 'monthly-defaulters') loadMonthlyDefaulters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, defMonthFilter]);

  useEffect(() => {
    if (historyStudentId) loadStudentHistory(historyStudentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyStudentId]);

  useEffect(() => {
    if (tab === 'total-fee' && !classFeesLoaded) loadClassFees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useLiveUpdates({
    'fees.changed': () => {
      loadMonthlyRecords();
      loadStats();
      loadDailyRecords();
      loadMonthlyDefaulters();
    },
    'students.changed': () => loadStudents(),
    'permissions.changed': () => refreshMyPermissions(() => setPermTick((n) => n + 1)),
    'class-fees.changed': () => loadClassFees(),
  });

  useEffect(() => {
    if (payFormRef.current) {
      return bindPanelKeyboardNavigation(payFormRef.current);
    }
  }, [payModalOpen]);

  // Close payStudentResults / historyStudentResults on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const payWrap = payWrapRef.current;
      if (payWrap && !payWrap.contains(e.target as Node)) setPayResultsOpen(false);
      const histWrap = historyWrapRef.current;
      if (histWrap && !histWrap.contains(e.target as Node)) setHistoryResultsOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  // Deferred search text: same technique as the Students page — typing
  // stays instantly responsive while the (larger, avatar-bearing) fee
  // tables trail a frame behind, so this tab never feels "stuck".
  const deferredFeeSearch = useDeferredValue(feeSearch);
  const deferredDefSearch = useDeferredValue(defSearch);

  // ---------------- Monthly tab filtering ----------------
  const filteredMonthly = useMemo(() => {
    const q = deferredFeeSearch.toLowerCase().trim();
    let list = monthlyData;
    if (q) {
      list = list.filter(
        (r) => `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) || String(r.roll_no || '').toLowerCase().includes(q)
      );
    }
    if (statusFilter) {
      list = list.filter((r) => {
        const due = +r.amount_due,
          paid = +r.amount_paid;
        if (statusFilter === 'paid') return paid >= due;
        if (statusFilter === 'partial') return paid > 0 && paid < due;
        if (statusFilter === 'unpaid') return paid === 0;
        return true;
      });
    }
    const wantBoys = feeFilterBoys,
      wantGirls = feeFilterGirls;
    if (wantBoys !== wantGirls) {
      list = list.filter((r) => (wantBoys && r.gender === 'male') || (wantGirls && r.gender === 'female'));
    }
    return list;
  }, [monthlyData, deferredFeeSearch, statusFilter, feeFilterBoys, feeFilterGirls]);

  // ---------------- Daily tab filtering ----------------
  const filteredDaily = useMemo(() => {
    let data = dailyList;
    const wantBoys = dailyFilterBoys,
      wantGirls = dailyFilterGirls;
    if (wantBoys !== wantGirls) {
      data = data.filter((r) => (wantBoys && r.gender === 'male') || (wantGirls && r.gender === 'female'));
    }
    return data;
  }, [dailyList, dailyFilterBoys, dailyFilterGirls]);
  const dailyTotal = useMemo(() => filteredDaily.reduce((s, r) => s + +r.amount_paid, 0), [filteredDaily]);

  // ---------------- Monthly defaulters filtering ----------------
  const filteredDefaulters = useMemo(() => {
    const q = deferredDefSearch.toLowerCase().trim();
    let filtered = defaultersList.filter(
      (r) => `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) || String(r.roll_no || '').toLowerCase().includes(q)
    );
    const wantBoys = defFilterBoys,
      wantGirls = defFilterGirls;
    if (wantBoys !== wantGirls) {
      filtered = filtered.filter((r) => (wantBoys && r.gender === 'male') || (wantGirls && r.gender === 'female'));
    }
    return filtered;
  }, [defaultersList, deferredDefSearch, defFilterBoys, defFilterGirls]);
  const groupedDefaulters = useMemo(() => groupDefaultersByMonth(filteredDefaulters), [filteredDefaulters]);

  const historyTotals = useMemo(() => {
    let totalDue = 0,
      totalPaid = 0;
    historyList.forEach((r) => {
      totalDue += +r.amount_due || 0;
      totalPaid += +r.amount_paid || 0;
    });
    return { totalDue, totalPaid };
  }, [historyList]);

  const historyMatches = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    const matches = q
      ? allStudents.filter(
          (s) =>
            `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) ||
            String(s.roll_no).includes(q) ||
            `${s.class}-${s.section}`.toLowerCase().includes(q)
        )
      : allStudents;
    return matches.slice(0, 50);
  }, [allStudents, historySearch]);

  const payMatches = useMemo(() => {
    const q = payStudentSearch.toLowerCase().trim();
    let matches = allStudents;
    if (q) {
      matches = allStudents.filter(
        (s) => String(s.roll_no || '').toLowerCase().includes(q) || `${s.first_name} ${s.last_name}`.toLowerCase().includes(q)
      );
    }
    return matches.slice(0, 30);
  }, [allStudents, payStudentSearch]);

  // ---------------- Print mode toggle ----------------
  function onPrintModeToggle(checked: boolean) {
    setThermalMode(checked);
    setPrintModeStorage(checked ? 'thermal' : 'paper');
  }

  // ---------------- Payment modal ----------------
  function openPayModal() {
    if (!canAddFees()) return;
    setEditingPaymentId(null);
    setPayStudentSel('');
    setPayStudentSearch('');
    setPayStudentDisabled(false);
    setPayMonthDisabled(false);
    setPayResultsOpen(false);
    setPayMonth(monthStr);
    setPayDue('');
    setPayPaid('');
    setExistingPayInfo('');
    setPayModalTitle('Record Fee Payment');
    setPaySaveLabel('Record Payment');
    setShowCustomDateGroup(canCustomDateFees());
    setUseCustomDate(false);
    setCustomDate(todayStr);
    setPayModalOpen(true);
  }

  function closePayModal() {
    setEditingPaymentId(null);
    setPayStudentDisabled(false);
    setPayMonthDisabled(false);
    setPayModalOpen(false);
  }

  function onUseCustomDateToggle(checked: boolean) {
    setUseCustomDate(checked);
    if (checked && !customDate) setCustomDate(todayStr);
  }

  function quickPay(studentId: number, name: string, due: number, paid: number, academicMonth: string) {
    openPayModal();
    setPayStudentSel(studentId);
    setPayStudentSearch(name);
    if (academicMonth) {
      setPayMonth(String(academicMonth).slice(0, 7));
      setPayMonthDisabled(true);
    }
    setPayDue(String(due));
    setPayPaid(String(due - paid));
    setPayModalTitle(academicMonth ? `Settle Balance — ${name} (${monthLabel(academicMonth)})` : `Record Payment — ${name}`);
    onStudentChangeFor(studentId, academicMonth ? String(academicMonth).slice(0, 7) : monthStr);
  }

  function editFeeRecord(paymentId: number, name: string, due: number, paid: number) {
    if (!canEditFees()) return;
    openPayModal();
    setEditingPaymentId(paymentId);
    setPayStudentSearch(name);
    setPayStudentDisabled(true);
    setPayMonthDisabled(true);
    setPayDue(String(due));
    setPayPaid(String(paid));
    setPayModalTitle(`Edit Payment — ${name}`);
    setPaySaveLabel('Save Changes');
    setShowCustomDateGroup(false);
  }

  function selectPayStudent(studentId: number) {
    const s = allStudents.find((st) => st.student_id === studentId);
    if (!s) return;
    setPayStudentSel(studentId);
    setPayStudentSearch(`Roll ${s.roll_no} — ${s.first_name} ${s.last_name}`);
    setPayResultsOpen(false);
    onStudentChangeFor(studentId, payMonth);
  }

  async function onStudentChangeFor(id: number | string, month: string) {
    if (!id) {
      setExistingPayInfo('');
      return;
    }
    try {
      const res = await api('GET', `/api/fees/student/${id}`);
      const data = normalizeList<FeeRow>(res, ['payments', 'fees', 'data']);
      const existing = data.find((r) => r.academic_month && r.academic_month.slice(0, 7) === month);
      if (existing) {
        setExistingPayInfo(
          `⚠️ Existing record for this month: Due ${formatMoney(existing.amount_due)}, Paid ${formatMoney(
            existing.amount_paid
          )}. New entry will be added.`
        );
      } else {
        setExistingPayInfo('');
      }
    } catch {
      // matches original's empty catch
    }
  }

  async function deleteFeeRecord(paymentId: number) {
    if (!canDeleteFees()) return;
    if (!confirm('Delete this fee payment record? This cannot be undone.')) return;
    try {
      await api('DELETE', `/api/fees/${paymentId}`);
      showToast('Payment record deleted.', 'success');
      loadMonthlyRecords();
      loadStats();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  async function savePayment() {
    const due = parseFloat(payDue) || 0;
    const paid = parseFloat(payPaid) || 0;

    if (editingPaymentId) {
      try {
        await api('PUT', `/api/fees/${editingPaymentId}`, { amount_due: due, amount_paid: paid });
        showToast('Payment record updated.', 'success');
        closePayModal();
        loadMonthlyRecords();
        loadStats();
      } catch (e: any) {
        showToast(e.message, 'error');
      }
      return;
    }

    if (!payStudentSel) {
      showToast('Select a student.', 'error');
      return;
    }
    if (!payMonth) {
      showToast('Select a month.', 'error');
      return;
    }
    if (paid < 0) {
      showToast('Amount paid cannot be negative.', 'error');
      return;
    }
    if (due > 0 && paid <= 0) {
      showToast('Enter a payment amount for a due fee.', 'error');
      return;
    }

    const useCD = canCustomDateFees() && useCustomDate;
    if (useCD && !customDate) {
      showToast('Pick a deposit date, or uncheck the custom date option.', 'error');
      return;
    }

    try {
      const body: any = {
        student_id: parseInt(String(payStudentSel), 10),
        academic_month: payMonth + '-01',
        amount_due: due,
        amount_paid: paid,
        print_mode: getPrintMode(),
      };
      if (useCD) body.payment_date = customDate;

      const res = await api('POST', '/api/fees', body);
      showToast('Payment recorded!', 'success');
      closePayModal();
      loadMonthlyRecords();
      loadStats();

      const p = (res as any)?.payment;
      if (p) openReceiptModal(p);
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  // ---------------- Receipt ----------------
  function normalizeReceiptData(r: FeeRow): ReceiptData {
    const s = r.student_id ? allStudents.find((st) => st.student_id === r.student_id) : null;
    const first_name = r.first_name || s?.first_name || '';
    const last_name = r.last_name || s?.last_name || '';
    const roll_no = r.roll_no ?? s?.roll_no;
    const cls = r.class || s?.class;
    const section = r.section || s?.section;
    const father_name = r.father_name || s?.father_name;
    const contact_1 = r.contact_1 || s?.contact_1;
    const photo_url = r.photo_url || s?.photo_url || '';

    const due = +r.amount_due || 0;
    const cumulativePaid = +r.amount_paid || 0;
    const thisPayment = r.this_payment_amount != null ? +r.this_payment_amount : cumulativePaid;

    const classLabel = baseClassFromSection(`${cls || ''}${section ? '-' + section : ''}`) || String(cls || '');
    const classFeeRow = classFees.find((c) => c.class === classLabel);
    const totalFee = classFeeRow ? +classFeeRow.total_fee : null;
    const discount = totalFee != null ? Math.max(0, totalFee - due) : null;

    return {
      receipt_no: r.receipt_no ?? r.payment_id ?? '—',
      roll_no: roll_no ?? '—',
      student_name: `${first_name} ${last_name}`.trim() || '—',
      class_section: `${cls || ''}${section ? '-' + section : ''}` || '—',
      father_name: father_name || '—',
      contact_1: contact_1 || '—',
      photo_url: photo_url || '',
      academic_month: monthLabel(r.academic_month),
      amount_due: due,
      amount_paid: thisPayment,
      balance: due - cumulativePaid,
      payment_date: r.payment_date ? new Date(r.payment_date) : new Date(),
      total_fee: totalFee,
      discount,
    };
  }

  function openReceiptModal(paymentRow: FeeRow) {
    setReceiptData(normalizeReceiptData(paymentRow));
    setReceiptModalOpen(true);
  }
  function closeReceiptModal() {
    setReceiptModalOpen(false);
  }

  function printMonthlyReceipt(i: number) {
    const d = normalizeReceiptData(filteredMonthly[i]);
    setReceiptData(d);
    printReceiptWith(d);
  }
  function printDailyReceipt(i: number) {
    const d = normalizeReceiptData(filteredDaily[i]);
    setReceiptData(d);
    printReceiptWith(d);
  }
  function printHistoryReceipt(i: number) {
    const row = { ...historyList[i], student_id: historyStudentId! } as FeeRow;
    const s = allStudents.find((st) => st.student_id === historyStudentId);
    if (s) Object.assign(row, { roll_no: s.roll_no, first_name: s.first_name, last_name: s.last_name, class: s.class, section: s.section });
    const d = normalizeReceiptData(row);
    setReceiptData(d);
    printReceiptWith(d);
  }

  function printReceipt() {
    if (receiptData) printReceiptWith(receiptData);
  }

  function printReceiptWith(d: ReceiptData) {
    if (getPrintMode() === 'thermal') {
      printThermalReceipt(d);
    } else {
      printPaperReceipt(d);
    }
  }

  function printPaperReceipt(d: ReceiptData) {
    const win = window.open('', '_blank');
    if (!win) {
      showToast('Please allow pop-ups to print the receipt.', 'error');
      return;
    }
    const SCHOOL_LOGO_URL = new URL('school-logo.png', window.location.href).href;

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<title>Fee Receipt — ${d.student_name}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 14mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; padding: 0; }
  .receipt { max-width: 170mm; margin: 0 auto; border: 1px solid #ccc; border-radius: 8px; padding: 22px 26px; }
  .header { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #1a1a2e; padding-bottom: 12px; margin-bottom: 16px; }
  .header img { width: 56px; height: 56px; object-fit: contain; }
  .receipt-photo { width: 100px; height: 100px; margin: 0 auto 14px; border-radius: 12px; overflow: hidden; border: 1px solid #ddd; }
  .receipt-photo img { width: 100%; height: 100%; object-fit: cover; }
  .header .school-name { font-size: 17px; font-weight: 700; }
  .header .sub { font-size: 11px; color: #666; margin-top: 2px; }
  .header .affiliation { font-size: 10px; color: #666; margin-top: 3px; }
  .title { text-align: center; font-size: 13px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #444; margin-bottom: 16px; }
  table.info { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 12px; }
  table.info td { padding: 5px 4px; vertical-align: top; }
  table.info td.label { color: #666; width: 120px; }
  table.fee { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.fee th, table.fee td { border: 1px solid #ddd; padding: 7px 9px; text-align: left; }
  table.fee th { background: #f0f0f0; color: #555; }
  .paid { color: #2d7a4f; font-weight: 700; }
  .due  { color: #b3261e; font-weight: 700; }
  .discount-note { font-size: 10.5px; color: #b3261e; font-style: italic; margin-top: 6px; }
  .remarks { margin-top: 14px; font-size: 12px; color: #444; }
  .remarks .label { color: #666; margin-right: 4px; }
  .remarks .line { display: inline-block; border-bottom: 1px solid #bbb; min-width: 60%; }
  .footer { display: flex; justify-content: space-between; margin-top: 56px; font-size: 11px; color: #666; }
  .footer .sign-block { width: 150px; text-align: center; }
  .footer .sign-line { border-top: 1px solid #999; padding-top: 4px; }
  .meta { text-align: right; font-size: 10px; color: #888; margin-top: -5px; margin-bottom: 12px; }
  .thanks { text-align: center; font-size: 12px; font-weight: 700; color: #444; margin-top: 24px; }
  @media print {
    body { padding: 0; }
    .receipt { border: none; }
  }
</style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <img src="${SCHOOL_LOGO_URL}" onerror="this.style.display='none'" alt="Logo"/>
      <div>
        <div class="school-name">${SCHOOL_NAME}</div>
        <div class="sub">Fee Payment Receipt</div>
        <div class="affiliation">Affiliated with Board of Intermediate and Secondary Education Rawalpindi</div>
      </div>
    </div>

    <div class="title">Fee Receipt</div>
    <div class="meta">Receipt No: ${d.receipt_no} &nbsp;|&nbsp; Fee Submitted: ${fmtDateTime(d.payment_date)}</div>
    ${d.photo_url ? `<div class="receipt-photo"><img src="${d.photo_url}" alt="Student photo" onerror="this.style.display='none'"/></div>` : ''}
    <table class="info">
      <tr><td class="label">Student Name</td><td>${d.student_name}</td>
          <td class="label">Roll No.</td><td>${d.roll_no}</td></tr>
      <tr><td class="label">Class / Section</td><td>${d.class_section}</td>
          <td class="label">Father's Name</td><td>${d.father_name}</td></tr>
      <tr><td class="label">Contact</td><td>${d.contact_1}</td>
          <td class="label">Fee Month</td><td>${d.academic_month}</td></tr>
    </table>

    <table class="fee">
      <thead><tr><th>Description</th><th>Amount (Rs.)</th></tr></thead>
      <tbody>
        ${d.total_fee != null ? `<tr><td>Total Fee</td><td>${d.total_fee.toLocaleString('en-PK')}</td></tr>` : ''}
        ${d.discount != null && d.discount > 0 ? `<tr><td>Discount</td><td class="paid">-${d.discount.toLocaleString('en-PK')}</td></tr>` : ''}
        <tr><td>${d.discount != null && d.discount > 0 ? 'Payable after Discount' : 'Amount Due'}</td><td>${d.amount_due.toLocaleString('en-PK')}</td></tr>
        <tr><td>Amount Paid</td><td class="paid">${d.amount_paid.toLocaleString('en-PK')}</td></tr>
        <tr><td>Balance</td><td class="${d.balance > 0 ? 'due' : ''}">${d.balance.toLocaleString('en-PK')}</td></tr>
      </tbody>
    </table>

    ${d.discount != null && d.discount > 0 ? '<div class="discount-note">* This discount is valid for 1 year only.</div>' : ''}

    <div class="footer">
      <div class="sign-block">
        <div class="sign-line">Signature</div>
      </div>
      <div class="sign-block">
        <div class="sign-line">Stamp</div>
      </div>
    </div>

    <div class="remarks"><span class="label">Remarks:</span><span class="line">&nbsp;</span></div>

    <div class="thanks">Thank you for your payment!</div>
  </div>
  <script>
    window.onload = function () { window.print(); };
  <\/script>
</body>
</html>`;

    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  function printThermalReceipt(d: ReceiptData) {
    const printedAt = new Date();
    const win = window.open('', '_blank');
    if (!win) {
      showToast('Please allow pop-ups to print the receipt.', 'error');
      return;
    }

    const row = (label: string, value: string | number) => `<div class="row"><span>${label}</span><span>${value}</span></div>`;

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<title>Receipt — ${d.student_name}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: 80mm auto; margin: 0; }
  body {
    font-family: 'Courier New', Consolas, monospace;
    color: #000; width: 76mm; margin: 0 auto; padding: 6px 4px;
    font-size: 12px; line-height: 1.5;
  }
  .center { text-align: center; }
  .school-name { font-size: 14px; font-weight: 700; text-transform: uppercase; }
  .sub { font-size: 10px; margin-top: 2px; }
  .divider { border-top: 1px dashed #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .row span:first-child { color: #333; }
  .title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin: 4px 0; }
  .amount-paid { font-weight: 700; }
  .discount-note { font-size: 10px; font-style: italic; margin: 4px 0; }
  .footer { margin-top: 10px; font-size: 10px; text-align: center; }
  .footer .thanks { font-weight: 700; margin-bottom: 2px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="center">
    <div class="school-name">${SCHOOL_NAME}</div>
    <div class="sub">Fee Payment Receipt</div>
  </div>
  <div class="divider"></div>

  ${row('Receipt No.', d.receipt_no)}
  ${row('Fee Submitted', fmtDateTime(d.payment_date))}
  ${row('Printed', fmtDateTime(printedAt))}
  <div class="divider"></div>

  <div class="title center">Student Details</div>
  ${row('Name', d.student_name)}
  ${row('Roll No.', d.roll_no)}
  ${row('Class', d.class_section)}
  ${row('Father', d.father_name)}
  <div class="divider"></div>

  <div class="title center">Fee Details</div>
  ${row('Month', d.academic_month)}
  ${d.total_fee != null ? row('Total Fee', d.total_fee.toLocaleString('en-PK')) : ''}
  ${d.discount != null && d.discount > 0 ? row('Discount', `-${d.discount.toLocaleString('en-PK')}`) : ''}
  ${row(d.discount != null && d.discount > 0 ? 'Payable after Discount' : 'Amount Due', d.amount_due.toLocaleString('en-PK'))}
  ${row('Amount Paid', `<span class="amount-paid">${d.amount_paid.toLocaleString('en-PK')}</span>`)}
  ${row('Balance', d.balance.toLocaleString('en-PK'))}
  <div class="divider"></div>
  ${d.discount != null && d.discount > 0 ? '<div class="discount-note center">* This discount is valid for 1 year only.</div>' : ''}

  <div class="footer">
    <div class="thanks">Thank you!</div>
    <div>Stamp</div>
  </div>
  <script>
    window.onload = function () { window.print(); };
  <\/script>
</body>
</html>`;

    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  function historyStudentLabel(s: StudentLite) {
    return `${s.class}-${s.section} | ${s.first_name} ${s.last_name}`;
  }
  function selectHistoryStudent(studentId: number) {
    const student = allStudents.find((s) => s.student_id === studentId);
    setHistorySearch(student ? historyStudentLabel(student) : '');
    setHistoryStudentId(studentId);
    setHistoryResultsOpen(false);
  }

  return (
    <>
      {/* Record Payment Modal */}
      <div className={`modal-overlay${payModalOpen ? ' open' : ''}`}>
        <div className="modal">
          <div className="modal-header">
            <h2 className="modal-title">{payModalTitle}</h2>
            <button className="modal-close" onClick={closePayModal}>
              ×
            </button>
          </div>
          <form ref={payFormRef} onSubmit={(e) => e.preventDefault()}>
            <div className="form-group relative" ref={payWrapRef as any}>
              <label>Student *</label>
              <input
                type="text"
                placeholder="Type roll no. or name…"
                autoComplete="off"
                className="mini-input"
                disabled={payStudentDisabled}
                value={payStudentSearch}
                onChange={(e) => {
                  setPayStudentSearch(e.target.value);
                  setPayStudentSel('');
                  setPayResultsOpen(true);
                }}
                onFocus={() => setPayResultsOpen(true)}
              />
              {payResultsOpen && (
                <div className="popup-panel block absolute z-20 left-0 right-0 top-full max-h-[180px] overflow-y-auto">
                  {payMatches.length === 0 ? (
                    <div className="text-muted px-2.5 py-2 text-xs">No matching student.</div>
                  ) : (
                    payMatches.map((s) => (
                      <div
                        key={s.student_id}
                        className="popup-option px-2.5 py-2 cursor-pointer text-[13px]"
                        onMouseDown={() => selectPayStudent(s.student_id)}
                      >
                        Roll {s.roll_no} — {s.first_name} {s.last_name} <span className="text-muted">({s.class}-{s.section})</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className="form-group">
              <label>Academic Month *</label>
              <input type="month" value={payMonth} disabled={payMonthDisabled} onChange={(e) => setPayMonth(e.target.value)} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Amount Due (Rs.)</label>
                <input type="number" step="0.01" placeholder="0" value={payDue} onChange={(e) => setPayDue(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Amount Paid (Rs.) *</label>
                <input type="number" step="0.01" placeholder="0" value={payPaid} onChange={(e) => setPayPaid(e.target.value)} />
              </div>
            </div>
            {showCustomDateGroup && (
              <div className="form-group">
                <label>
                  <input type="checkbox" checked={useCustomDate} onChange={(e) => onUseCustomDateToggle(e.target.checked)} />
                  Deposit on a different day (e.g. fee came in yesterday)
                </label>
                {useCustomDate && (
                  <input type="date" className="mt-1.5 block" value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
                )}
                <div className="text-muted text-xs mt-1">
                  This payment (and its receipt) will appear under the collection totals for the date you pick instead of today.
                </div>
              </div>
            )}
            <div className="text-muted text-xs mb-2.5">
              For free students, enter 0 for both Amount Due and Amount Paid.
            </div>
            {existingPayInfo && (
              <div className="notice-box p-2.5 rounded mb-2.5 text-xs">
                {existingPayInfo}
              </div>

            )}
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={closePayModal}>
                Cancel
              </button>
              <button type="button" className="btn btn-success" onClick={savePayment}>
                {paySaveLabel}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Payment Receipt Modal */}
      <div className={`modal-overlay${receiptModalOpen ? ' open' : ''}`}>
        <div className="modal">
          <div className="modal-header">
            <h2 className="modal-title">Payment Recorded</h2>
            <button className="modal-close" onClick={closeReceiptModal}>
              ×
            </button>
          </div>
          <div className="px-0.5 pt-1 pb-3.5 text-[13px] text-text">
            <div className="text-center mb-2.5">
              <div className="text-[32px]">✅</div>
              <div>Payment saved successfully.</div>
            </div>
            {receiptData && (
              <div className="popup-panel rounded-md px-3 py-2.5 leading-relaxed">
                {receiptData.photo_url && (
                  <div className="mb-3 flex justify-center">
                    <img
                      src={receiptData.photo_url}
                      alt="Student photo"
                      className="border-input w-[120px] h-[120px] object-cover rounded-2xl"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}
                <div>
                  <strong>{receiptData.student_name}</strong> &nbsp; (Roll {receiptData.roll_no}, Class {receiptData.class_section})
                </div>
                <div>
                  Month: <strong>{receiptData.academic_month}</strong>
                </div>
                <div>
                  Amount Paid: <strong className="fee-paid">{formatMoney(receiptData.amount_paid)}</strong>
                  {receiptData.balance > 0 && (
                    <>
                      {' '}
                      &nbsp;|&nbsp; Balance: <strong className="fee-unpaid">{formatMoney(receiptData.balance)}</strong>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn btn-outline" onClick={closeReceiptModal}>
              Close
            </button>
            <button className="btn btn-success" onClick={printReceipt}>
              🖨 Print Receipt
            </button>
          </div>
        </div>
      </div>

      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Fee Management</h1>
          <div className="flex items-center gap-3.5">
            <div className="period-switch" title="Choose which receipt layout printing uses">
              <span className={`period-label${thermalMode ? ' inactive' : ''}`}>Paper</span>
              <label className="toggle-switch">
                <input type="checkbox" checked={thermalMode} onChange={(e) => onPrintModeToggle(e.target.checked)} />
                <span className="toggle-slider"></span>
              </label>
              <span className={`period-label${!thermalMode ? ' inactive' : ''}`}>Thermal</span>
            </div>
            {canAddFees() && (
              <button className="btn btn-success transition-transform duration-150 active:scale-95" onClick={openPayModal}>
                + Record Payment
              </button>
            )}
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <div className="label">Collected (Month)</div>
            <div className="value">{statCollected}</div>
          </div>
          <div className="stat-card">
            <div className="label">Monthly Defaulters</div>
            <div className="value">{statDefaulters}</div>
          </div>
          <div className="stat-card">
            <div className="label">Collected Today</div>
            <div className="value">{statToday}</div>
          </div>
        </div>

        <div className="flex gap-0.5 mb-4 border-b border-border overflow-x-auto">
          <button className={`tab-btn${tab === 'monthly' ? ' active' : ''}`} onClick={() => setTab('monthly')}>
            Monthly Records
          </button>
          <button className={`tab-btn${tab === 'daily' ? ' active' : ''}`} onClick={() => setTab('daily')}>
            Daily Collections
          </button>
          <button className={`tab-btn${tab === 'monthly-defaulters' ? ' active' : ''}`} onClick={() => setTab('monthly-defaulters')}>
            Monthly Defaulters
          </button>
          <button className={`tab-btn${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>
            Student History
          </button>
          <button className={`tab-btn${tab === 'total-fee' ? ' active' : ''}`} onClick={() => setTab('total-fee')}>
            Total Fee
          </button>
        </div>

        {/* MONTHLY TAB */}
        {tab === 'monthly' && (
          <div>
            <div className="card mb-3">
              <div className="filters">
                <label className="text-muted text-xs">
                  Month:
                </label>
                <input type="month" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} />
                <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
                  <option value="">All Classes</option>
                  <option>Nursery</option>
                  <option>KG</option>
                  <option>1</option>
                  <option>2</option>
                  <option>3</option>
                  <option>4</option>
                  <option>5</option>
                  <option>6</option>
                  <option>7</option>
                  <option>8</option>
                  <option>9</option>
                  <option>10</option>
                </select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All Status</option>
                  <option value="paid">Paid</option>
                  <option value="partial">Partial</option>
                  <option value="unpaid">Unpaid</option>
                </select>
                <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
                  <input type="checkbox" checked={feeFilterBoys} onChange={(e) => setFeeFilterBoys(e.target.checked)} /> Boys
                </label>
                <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
                  <input type="checkbox" checked={feeFilterGirls} onChange={(e) => setFeeFilterGirls(e.target.checked)} /> Girls
                </label>
                <input
                  type="text"
                  placeholder="Search student…"
                  className="mini-input w-[180px]"
                  value={feeSearch}
                  onChange={(e) => setFeeSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Photo</th>
                      <th>Roll</th>
                      <th>Student</th>
                      <th>Class</th>
                      <th>Section</th>
                      <th>Due</th>
                      <th>Paid</th>
                      <th>Balance</th>
                      <th>Status</th>
                      <th>Date</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyLoadFailed ? (
                      <tr>
                        <td colSpan={12} className="empty">
                          Failed to load.
                        </td>
                      </tr>
                    ) : filteredMonthly.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="empty">
                          No records found.
                        </td>
                      </tr>
                    ) : (
                      filteredMonthly.map((r, i) => {
                        const due = +r.amount_due || 0;
                        const paid = +r.amount_paid || 0;
                        const bal = due - paid;
                        const canPay = bal > 0;
                        let stCls: string, stLabel: string;
                        if (due === 0 && paid === 0) {
                          stCls = 'badge-success';
                          stLabel = 'Free';
                        } else if (paid >= due) {
                          stCls = 'badge-success';
                          stLabel = 'Paid';
                        } else if (paid > 0) {
                          stCls = 'badge-warning';
                          stLabel = 'Partial';
                        } else {
                          stCls = 'badge-danger';
                          stLabel = 'Unpaid';
                        }
                        return (
                          <tr key={r.payment_id ?? `${r.student_id}-${i}`}>
                            <td>{i + 1}</td>
                            <td>
                              <Avatar src={r.photo_url} name={`${r.first_name} ${r.last_name || ''}`} />
                            </td>
                            <td>{r.roll_no}</td>
                            <td>
                              {r.first_name} {r.last_name}
                            </td>
                            <td>{r.class}</td>
                            <td>{r.section}</td>
                            <td>{formatMoney(due)}</td>
                            <td className={paid >= due ? 'fee-paid' : paid > 0 ? 'fee-partial' : 'fee-unpaid'}>{formatMoney(paid)}</td>
                            <td>{bal > 0 ? formatMoney(bal) : '—'}</td>
                            <td>
                              <span className={`badge ${stCls}`}>{stLabel}</span>
                            </td>
                            <td>{r.payment_date ? formatDate(r.payment_date) : '—'}</td>
                            <td className="whitespace-nowrap">
                              {canPay && (
                                <button
                                  className="btn btn-outline btn-sm"
                                  onClick={() => quickPay(r.student_id, `${r.first_name} ${r.last_name}`, due, paid, r.academic_month)}
                                >
                                  Pay
                                </button>
                              )}
                              <button className="btn btn-outline btn-sm" title="Print receipt" onClick={() => printMonthlyReceipt(i)}>
                                🖨
                              </button>
                              {canEditFees() && r.payment_id && (
                                <button
                                  className="btn btn-outline btn-sm"
                                  title="Edit record"
                                  onClick={() => editFeeRecord(r.payment_id!, `${r.first_name} ${r.last_name}`, due, paid)}
                                >
                                  ✏️
                                </button>
                              )}
                              {canDeleteFees() && r.payment_id && (
                                <button className="btn btn-outline btn-sm" title="Delete record" onClick={() => deleteFeeRecord(r.payment_id!)}>
                                  🗑
                                </button>
                              )}
                            </td>
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

        {/* DAILY TAB */}
        {tab === 'daily' && (
          <div>
            <div className="card mb-3">
              <div className="filters">
                <label className="text-secondary text-xs">Date:</label>
                <input type="date" value={dailyDateFilter} onChange={(e) => setDailyDateFilter(e.target.value)} />
                <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
                  <input type="checkbox" checked={dailyFilterBoys} onChange={(e) => setDailyFilterBoys(e.target.checked)} /> Boys
                </label>
                <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
                  <input type="checkbox" checked={dailyFilterGirls} onChange={(e) => setDailyFilterGirls(e.target.checked)} /> Girls
                </label>
              </div>
            </div>
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Photo</th>
                      <th>Student</th>
                      <th>Class</th>
                      <th>Section</th>
                      <th>Month</th>
                      <th>Amount Paid</th>
                      <th>Time</th>
                      <th>Receipt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!dailyLoaded ? (
                      <tr>
                        <td colSpan={9} className="loading">
                          Select date
                        </td>
                      </tr>
                    ) : dailyLoadFailed ? (
                      <tr>
                        <td colSpan={9} className="empty">
                          Failed to load.
                        </td>
                      </tr>
                    ) : filteredDaily.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="empty">
                          No payments on this date.
                        </td>
                      </tr>
                    ) : (
                      filteredDaily.map((r, i) => (
                        <tr key={r.payment_id ?? `${r.student_id}-${i}`}>
                          <td>{i + 1}</td>
                          <td>
                            <Avatar src={r.photo_url} name={`${r.first_name} ${r.last_name || ''}`} />
                          </td>
                          <td>
                            {r.first_name} {r.last_name}
                          </td>
                          <td>{r.class}</td>
                          <td>{r.section}</td>
                          <td>{monthLabel(r.academic_month)}</td>
                          <td className="fee-paid">{formatMoney(r.amount_paid)}</td>
                          <td className="text-muted text-xs">
                            {r.payment_date ? new Date(r.payment_date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}
                          </td>
                          <td>
                            <button className="btn btn-outline btn-sm" title="Print receipt" onClick={() => printDailyReceipt(i)}>
                              🖨
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {filteredDaily.length > 0 && (
                <div className="amount-success text-right text-[13px] font-semibold pt-2.5">
                  Total Collected: {formatMoney(dailyTotal)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* MONTHLY DEFAULTERS TAB */}
        {tab === 'monthly-defaulters' && (
          <div>
            <div className="card mb-3">
              <div className="filters">
                <label className="text-secondary text-xs">Month:</label>
                <input type="month" value={defMonthFilter} onChange={(e) => setDefMonthFilter(e.target.value)} />
                <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
                  <input type="checkbox" checked={defFilterBoys} onChange={(e) => setDefFilterBoys(e.target.checked)} /> Boys
                </label>
                <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
                  <input type="checkbox" checked={defFilterGirls} onChange={(e) => setDefFilterGirls(e.target.checked)} /> Girls
                </label>
                <input
                  type="text"
                  placeholder="Search student…"
                  className="border-input px-2.5 py-[7px] rounded text-[13px] flex-1 min-w-[180px]"
                  value={defSearch}
                  onChange={(e) => setDefSearch(e.target.value)}
                />
                {defaultersLoaded && !defaultersLoadFailed && (
                  <span className="text-secondary text-sm font-semibold ml-auto">
                    {filteredDefaulters.length} defaulter month{filteredDefaulters.length !== 1 ? 's' : ''} total
                  </span>
                )}
              </div>
            </div>
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Photo</th>
                      <th>Month</th>
                      <th>Roll</th>
                      <th>Student</th>
                      <th>Class</th>
                      <th>Section</th>
                      <th>Due</th>
                      <th>Paid</th>
                      <th>Balance</th>
                      <th>Contact</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!defaultersLoaded ? (
                      <tr>
                        <td colSpan={12} className="loading">
                          Loading…
                        </td>
                      </tr>
                    ) : defaultersLoadFailed ? (
                      <tr>
                        <td colSpan={12} className="empty">
                          Failed to load.
                        </td>
                      </tr>
                    ) : groupedDefaulters.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="empty">
                          {defSearch || defFilterBoys || defFilterGirls ? 'No matching students.' : 'No monthly defaulters. 🎉'}
                        </td>
                      </tr>
                    ) : (
                      (() => {
                        let rowCounter = 0;
                        return groupedDefaulters.map((group) => (
                          <Fragment key={`group-${group.academic_month}`}>
                            <tr className="group-header-row" key={`hdr-${group.academic_month}`}>
                              <td colSpan={12} className="font-semibold px-2.5 py-2">
                                {monthLabel(group.academic_month)} — {group.count} defaulter{group.count !== 1 ? 's' : ''}
                              </td>
                            </tr>
                            {group.defaulters.map((r) => {
                              rowCounter += 1;
                              const due = +r.amount_due || 0;
                              const paid = +r.amount_paid || 0;
                              const canPay = due > 0 && paid < due;
                              return (
                                <tr key={`${group.academic_month}-${r.student_id}`}>
                                  <td>{rowCounter}</td>
                                  <td>
                                    <Avatar src={r.photo_url} name={`${r.first_name} ${r.last_name || ''}`} />
                                  </td>
                                  <td>{monthLabel(r.academic_month)}</td>
                                  <td>{r.roll_no}</td>
                                  <td>
                                    {r.first_name} {r.last_name}
                                  </td>
                                  <td>{r.class}</td>
                                  <td>{r.section}</td>
                                  <td className={due > 0 ? 'fee-unpaid' : ''}>{formatMoney(r.amount_due)}</td>
                                  <td className="fee-paid">{formatMoney(r.amount_paid)}</td>
                                  <td className={due - paid > 0 ? 'fee-unpaid' : ''}>{formatMoney(r.balance)}</td>
                                  <td>{r.contact_1 || '—'}</td>
                                  <td>
                                    {canPay && canAddFees() ? (
                                      <button
                                        className="btn btn-outline btn-sm"
                                        onClick={() => quickPay(r.student_id, `${r.first_name} ${r.last_name}`, due, paid, r.academic_month)}
                                      >
                                        Pay
                                      </button>
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </Fragment>
                        ));
                      })()
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* HISTORY TAB */}
        {tab === 'history' && (
          <div>
            <div className="card mb-3">
              <div className="filters">
                <div ref={historyWrapRef} className="relative min-w-[280px]">
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder="Search student by name or roll no…"
                    className="border-input w-full px-2.5 py-[7px] rounded text-[13px] box-border"
                    value={historySearch}
                    onChange={(e) => {
                      setHistorySearch(e.target.value);
                      setHistoryResultsOpen(true);
                    }}
                    onFocus={() => setHistoryResultsOpen(true)}
                  />
                  {historyResultsOpen && (
                    <div className="popup-panel block absolute top-full left-0 right-0 z-20 max-h-[260px] overflow-y-auto rounded-b">
                      {historyMatches.length === 0 ? (
                        <div className="text-muted px-2.5 py-2 text-[13px]">
                          No matching students.
                        </div>
                      ) : (
                        historyMatches.map((s) => (
                          <div
                            key={s.student_id}
                            className="popup-option"
                            onMouseDown={() => selectHistoryStudent(s.student_id)}
                          >
                            {historyStudentLabel(s)}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Month</th>
                      <th>Due</th>
                      <th>Paid</th>
                      <th>Balance</th>
                      <th>Status</th>
                      <th>Date</th>
                      <th>Receipt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!historyStudentId ? (
                      <tr>
                        <td colSpan={8} className="empty">
                          Select a student above.
                        </td>
                      </tr>
                    ) : !historyLoaded ? (
                      <tr>
                        <td colSpan={8} className="loading">
                          Loading…
                        </td>
                      </tr>
                    ) : historyLoadFailed ? (
                      <tr>
                        <td colSpan={8} className="empty">
                          Failed to load.
                        </td>
                      </tr>
                    ) : historyList.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="empty">
                          No payment history.
                        </td>
                      </tr>
                    ) : (
                      historyList.map((r, i) => {
                        const due = +r.amount_due || 0;
                        const paid = +r.amount_paid || 0;
                        const bal = due - paid;
                        let stCls: string, stLabel: string;
                        if (due === 0 && paid === 0) {
                          stCls = 'badge-success';
                          stLabel = 'Free';
                        } else if (paid >= due) {
                          stCls = 'badge-success';
                          stLabel = 'Paid';
                        } else if (paid > 0) {
                          stCls = 'badge-warning';
                          stLabel = 'Partial';
                        } else {
                          stCls = 'badge-danger';
                          stLabel = 'Unpaid';
                        }
                        return (
                          <tr key={r.payment_id ?? i}>
                            <td>{i + 1}</td>
                            <td>{monthLabel(r.academic_month)}</td>
                            <td>{formatMoney(due)}</td>
                            <td className={paid >= due ? 'fee-paid' : paid > 0 ? 'fee-partial' : 'fee-unpaid'}>{formatMoney(paid)}</td>
                            <td>{bal > 0 ? formatMoney(bal) : '—'}</td>
                            <td>
                              <span className={`badge ${stCls}`}>{stLabel}</span>
                            </td>
                            <td>{r.payment_date ? formatDate(r.payment_date) : '—'}</td>
                            <td>
                              <button className="btn btn-outline btn-sm" title="Print receipt" onClick={() => printHistoryReceipt(i)}>
                                🖨
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {historyList.length > 0 && (
                <div className="text-secondary pt-2 text-[13px]">
                  Total Due: <strong>{formatMoney(historyTotals.totalDue)}</strong> &nbsp;|&nbsp; Total Paid:{' '}
                  <strong className="fee-paid">{formatMoney(historyTotals.totalPaid)}</strong> &nbsp;|&nbsp; Outstanding:{' '}
                  <strong className="fee-unpaid">{formatMoney(historyTotals.totalDue - historyTotals.totalPaid)}</strong>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TOTAL FEE TAB (global per-class fee settings) */}
        {tab === 'total-fee' && (
          <div>
            <div className="card mb-3">
              <div className="text-secondary text-[13px] mb-2">
                Set the total (full) fee for each class. This is used only to print the discount line on
                receipts — it does not change monthly Amount Due/Paid/Balance anywhere else.
              </div>
              {canAddClassFees() && (
                <div className="filters">
                  <select
                    className="border-input px-2.5 py-[7px] rounded text-[13px]"
                    value={newFeeClass}
                    onChange={(e) => setNewFeeClass(e.target.value)}
                  >
                    <option value="">Select class…</option>
                    {availableClassesToAdd.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Total fee (Rs.)"
                    className="border-input px-2.5 py-[7px] rounded text-[13px] w-[160px]"
                    value={newFeeAmount}
                    onChange={(e) => setNewFeeAmount(e.target.value)}
                  />
                  <button className="btn btn-success btn-sm" onClick={addClassFee}>
                    + Add
                  </button>
                </div>
              )}
            </div>

            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Class</th>
                      <th>Total Fee (Rs.)</th>
                      <th>Last Updated</th>
                      <th>Updated By</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!classFeesLoaded ? (
                      <tr>
                        <td colSpan={6} className="loading">
                          Loading…
                        </td>
                      </tr>
                    ) : classFeesLoadFailed ? (
                      <tr>
                        <td colSpan={6} className="empty">
                          Failed to load.
                        </td>
                      </tr>
                    ) : classFees.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="empty">
                          No class total fees configured yet.
                        </td>
                      </tr>
                    ) : (
                      classFees.map((row, i) => (
                        <tr key={row.class_fee_id}>
                          <td>{i + 1}</td>
                          <td>{row.class}</td>
                          <td>
                            {editingClassFeeId === row.class_fee_id ? (
                              <input
                                type="number"
                                step="0.01"
                                autoFocus
                                className="border-input px-2 py-1 rounded text-[13px] w-[120px]"
                                value={editingClassFeeAmount}
                                onChange={(e) => setEditingClassFeeAmount(e.target.value)}
                              />
                            ) : (
                              formatMoney(row.total_fee)
                            )}
                          </td>
                          <td>{row.updated_at ? formatDate(row.updated_at) : '—'}</td>
                          <td>{row.updated_by || '—'}</td>
                          <td>
                            <div className="flex gap-1.5">
                              {editingClassFeeId === row.class_fee_id ? (
                                <>
                                  <button className="btn btn-success btn-sm" onClick={() => saveEditClassFee(row.class_fee_id)}>
                                    Save
                                  </button>
                                  <button className="btn btn-outline btn-sm" onClick={cancelEditClassFee}>
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  {canEditClassFees() && (
                                    <button className="btn btn-outline btn-sm" onClick={() => startEditClassFee(row)}>
                                      Edit
                                    </button>
                                  )}
                                  {canDeleteClassFees() && (
                                    <button className="btn btn-outline btn-sm" onClick={() => deleteClassFee(row.class_fee_id)}>
                                      Delete
                                    </button>
                                  )}
                                  {!canEditClassFees() && !canDeleteClassFees() && '—'}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .tab-btn {
          background: none;
          border: none;
          padding: 8px 18px;
          font-size: 13px;
          cursor: pointer;
          color: var(--muted);
          border-bottom: 2px solid transparent;
          font-weight: 500;
        }
        .tab-btn.active {
          color: var(--text);
          border-bottom-color: var(--text);
        }
        .tab-btn:hover {
          color: var(--text);
        }
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
        @media (max-width: 768px) {
          .tab-btn {
            padding: 10px 16px;
            min-height: 40px;
            white-space: nowrap;
          }
        }
      `}</style>
    </>
  );
}