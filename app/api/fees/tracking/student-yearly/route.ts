import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   GET /api/fees/tracking/student-yearly?year=YYYY
   New endpoint (student-tracking view). Returns every active student with
   a 12-column academic-year fee grid running April(YYYY) → March(YYYY+1),
   each column carrying { due, paid, date } for that academic_month.
   Additive only — does not touch /tracking/monthly or /tracking/yearly,
   which stay exactly as before for the existing Fee Tracking view.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const yearParam = req.nextUrl.searchParams.get('year');
    const startYear = yearParam && /^\d{4}$/.test(yearParam) ? parseInt(yearParam, 10) : new Date().getFullYear();

    // Academic session: April startYear -> March startYear+1 (12 months).
    const sessionStart = `${startYear}-04-01`;
    const sessionEndExclusive = `${startYear + 1}-04-01`;

    const students = await prisma.student.findMany({
      orderBy: [{ class: 'asc' }, { section: 'asc' }, { roll_no: 'asc' }],
      select: {
        student_id: true,
        roll_no: true,
        first_name: true,
        last_name: true,
        father_name: true,
        class: true,
        section: true,
        gender: true,
        photo_url: true,
      },
    });

    const payments = await prisma.$queryRaw<any[]>`
      SELECT
        fp.student_id,
        DATE_TRUNC('month', fp.academic_month)::date AS academic_month,
        SUM(fp.amount_due)  AS amount_due,
        SUM(fp.amount_paid) AS amount_paid,
        MAX(fp.payment_date) AS last_payment_date
      FROM fee_payments fp
      WHERE fp.academic_month >= ${sessionStart}::date
        AND fp.academic_month <  ${sessionEndExclusive}::date
      GROUP BY fp.student_id, DATE_TRUNC('month', fp.academic_month)
    `;

    // Build 12 month keys, April startYear .. March startYear+1.
    const monthKeys: string[] = [];
    for (let i = 0; i < 12; i++) {
      const m = (3 + i) % 12; // 3 = April (0-indexed)
      const y = startYear + Math.floor((3 + i) / 12);
      monthKeys.push(`${y}-${String(m + 1).padStart(2, '0')}`);
    }

    const byStudent = new Map<number, Map<string, any>>();
    for (const p of payments) {
      // BUGFIX: academic_month comes back from $queryRaw as a JS Date
      // object. String(dateObj) produces a human-readable form like
      // "Wed Apr 01 2026 00:00:00 GMT+0000 (...)", NOT an ISO string —
      // so the old `String(p.academic_month).slice(0, 7)` produced
      // "Wed Apr" instead of "2026-04", which never matched any
      // monthKey and silently dropped every payment from the grid
      // (always showing dashes even for months with real data).
      // toISOString().slice(0, 7) gives the correct "YYYY-MM".
      const key = new Date(p.academic_month).toISOString().slice(0, 7);
      const sid = p.student_id as number;
      if (!byStudent.has(sid)) byStudent.set(sid, new Map());
      byStudent.get(sid)!.set(key, p);
    }

    const rows = students.map((s: (typeof students)[number]) => {
      const monthMap = byStudent.get(s.student_id) || new Map();
      const months: Record<string, { due: number; paid: number; date: string | null }> = {};
      for (const key of monthKeys) {
        const rec = monthMap.get(key);
        months[key] = {
          due: rec ? Number(rec.amount_due) || 0 : 0,
          paid: rec ? Number(rec.amount_paid) || 0 : 0,
          date: rec && rec.last_payment_date ? new Date(rec.last_payment_date).toISOString().slice(0, 10) : null,
        };
      }
      return {
        student_id: s.student_id,
        roll_no: s.roll_no,
        first_name: s.first_name,
        last_name: s.last_name,
        father_name: s.father_name,
        class: s.class,
        section: s.section,
        gender: s.gender,
        photo_url: s.photo_url,
        months,
      };
    });

    return NextResponse.json({ year: startYear, month_keys: monthKeys, count: rows.length, students: rows });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
