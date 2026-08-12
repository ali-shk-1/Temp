import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, can, userHasPermission } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';
import { sendMail } from '@/lib/mailer';
import { normalizeMonthInput } from '@/lib/fees-helpers';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatPaymentDate(d: unknown): string {
  // payment_date is a `timestamp` column (no @db.Date), so $queryRaw
  // returns it as a JS Date object in the normal case -- NOT a string.
  // The old version only handled the string case (regex match on
  // 'YYYY-MM-DD...') and silently fell back to *today's* date for any
  // Date object input, which meant every receipt email showed today's
  // date instead of the actual payment date whenever a payment used the
  // default (non-custom) payment_date. Handle Date objects directly,
  // using UTC components since the column has no timezone and Postgres
  // returns midnight-UTC for date-only inserts (e.g. the ::DATE cast
  // used for customPaymentDate).
  if (d instanceof Date && !isNaN(d.getTime())) {
    return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  const match = d ? String(d).match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  if (match) {
    const [, y, mo, day] = match;
    return `${Number(day)} ${MONTH_NAMES[Number(mo) - 1]} ${y}`;
  }
  // Only reached if payment_date is genuinely null/unparseable.
  const now = new Date();
  return `${now.getDate()} ${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
}

function formatAcademicMonth(d: unknown): string {
  // academic_month is a `DATE` column ($db.Date, no time component), so
  // $queryRaw returns it as a JS Date object -- NOT a "YYYY-MM" string.
  // The old code did String(d).split('-'), which on a Date object's
  // default toString() (e.g. "Mon Jun 01 2026 05:00:00 GMT+0500 ...")
  // produced garbage ("undefined <that whole string>") in receipt
  // emails. Use UTC components directly, same convention as
  // formatPaymentDate above, and support a raw "YYYY-MM"/"YYYY-MM-DD"
  // string as a fallback in case a caller ever passes one directly.
  if (d instanceof Date && !isNaN(d.getTime())) {
    return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  const match = d ? String(d).match(/^(\d{4})-(\d{2})/) : null;
  if (match) {
    const [, y, mo] = match;
    return `${MONTH_NAMES[Number(mo) - 1]} ${y}`;
  }
  const now = new Date();
  return `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
}

function formatCurrency(value: unknown): string {
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 0,
  }).format(Number(value || 0));
}

/* ─────────────────────────────────────────
   POST /api/fees
   Ported from routes/fees.js `POST /`.

   Uses a raw-SQL transaction ($transaction with a callback + $queryRaw /
   $executeRaw) rather than the query-builder throughout, because:
     - pg_advisory_xact_lock has no Prisma equivalent
     - the "does a fee record already exist for this month" check, the
       joined-with-student-info receipt re-fetch (with a derived
       month_totals subquery), and the conditional receipt insert are all
       easiest to keep byte-for-byte identical to the original this way,
       which matters a lot for a route this financially sensitive.
───────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'fees.add');
  if (denied) return denied;

  try {
    const body = await req.json();
    const { student_id, academic_month, amount_due, amount_paid, payment_date } = body;

    if (!student_id || !academic_month || amount_due == null) {
      return NextResponse.json(
        { error: 'student_id, academic_month, and amount_due are required.' },
        { status: 400 }
      );
    }

    // Optional "deposit on a different day" override, gated by its own
    // permission — see original comment (preserved conceptually above).
    let customPaymentDate: string | null = null;
    if (payment_date != null && payment_date !== '') {
      const isValidDate =
        /^\d{4}-\d{2}-\d{2}$/.test(String(payment_date).trim()) &&
        !isNaN(new Date(payment_date).getTime());
      if (!isValidDate) {
        return NextResponse.json({ error: 'payment_date must be in YYYY-MM-DD format.' }, { status: 400 });
      }
      const allowed = await userHasPermission(auth.user.role, 'fees.custom_date');
      if (!allowed) {
        return NextResponse.json(
          { error: "Access denied. You don't have permission to set a custom deposit date (fees.custom_date)." },
          { status: 403 }
        );
      }
      customPaymentDate = String(payment_date).trim();
    }

    const printMode = body.print_mode === 'thermal' ? 'thermal' : 'paper';
    const issuedBy = auth.user.username || null;

    const result = await prisma.$transaction(async (tx) => {
      // Serialize concurrent submissions for the same student — see
      // original comment. pg_advisory_xact_lock is auto-released on
      // commit/rollback of this transaction.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BigInt(student_id)}::bigint)`;

      const studentCheck = await tx.$queryRaw<{ student_id: number }[]>`
        SELECT student_id FROM students WHERE student_id = ${student_id}
      `;
      if (studentCheck.length === 0) {
        return { notFound: true as const };
      }

      const existingMonth = await tx.$queryRaw<{ x: number }[]>`
        SELECT 1 AS x FROM fee_payments
        WHERE student_id = ${student_id}
          AND DATE_TRUNC('month', academic_month) = DATE_TRUNC('month', ${academic_month}::DATE)
        LIMIT 1
      `;
      const insertedDue = existingMonth.length ? 0 : amount_due;
      const insertedPaid = amount_paid || 0;

      const inserted = customPaymentDate
        ? await tx.$queryRaw<{ payment_id: number }[]>`
            INSERT INTO fee_payments (student_id, academic_month, amount_due, amount_paid, payment_date)
            VALUES (${student_id}, ${academic_month}::DATE, ${insertedDue}, ${insertedPaid}, ${customPaymentDate}::DATE)
            RETURNING *
          `
        : await tx.$queryRaw<{ payment_id: number }[]>`
            INSERT INTO fee_payments (student_id, academic_month, amount_due, amount_paid)
            VALUES (${student_id}, ${academic_month}::DATE, ${insertedDue}, ${insertedPaid})
            RETURNING *
          `;
      const paymentId = inserted[0].payment_id;

      // Re-fetch joined with student info + month totals — see original
      // comment on why amount_due/amount_paid/balance are MONTH TOTALS,
      // not just this row.
      const receiptRows = await tx.$queryRaw<any[]>`
        SELECT fp.payment_id, fp.student_id, fp.academic_month, fp.payment_date,
               fp.amount_paid AS this_payment_amount,
               month_totals.amount_due, month_totals.amount_paid,
               (month_totals.amount_due - month_totals.amount_paid) AS balance,
               s.roll_no, s.first_name, s.last_name, s.class, s.section,
               s.father_name, s.contact_1, s.contact_2, s.address, s.email, s.photo_url
        FROM fee_payments fp
        JOIN students s ON s.student_id = fp.student_id
        JOIN (
          SELECT student_id,
                 DATE_TRUNC('month', academic_month) AS month,
                 SUM(amount_due)  AS amount_due,
                 SUM(amount_paid) AS amount_paid
          FROM fee_payments
          WHERE student_id = ${student_id}
            AND DATE_TRUNC('month', academic_month) = DATE_TRUNC('month', ${academic_month}::DATE)
          GROUP BY student_id, DATE_TRUNC('month', academic_month)
        ) month_totals ON month_totals.student_id = fp.student_id
        WHERE fp.payment_id = ${paymentId}
      `;

      const paymentRow = receiptRows[0];
      let receiptNo: number | null = null;
      if (paymentRow) {
        const studentName = `${paymentRow.first_name || ''} ${paymentRow.last_name || ''}`.trim();
        const receiptInsert = customPaymentDate
          ? await tx.$queryRaw<{ receipt_no: number }[]>`
              INSERT INTO payment_receipts
                (payment_id, student_id, roll_no, student_name, class, section, academic_month, amount_due, amount_paid, print_mode, issued_by, issued_at)
              VALUES (${paymentId}, ${student_id}, ${paymentRow.roll_no}, ${studentName},
                      ${paymentRow.class}, ${paymentRow.section}, ${academic_month}::DATE,
                      ${paymentRow.amount_due}, ${paymentRow.this_payment_amount},
                      ${printMode}, ${issuedBy}, ${customPaymentDate}::DATE)
              RETURNING receipt_no
            `
          : await tx.$queryRaw<{ receipt_no: number }[]>`
              INSERT INTO payment_receipts
                (payment_id, student_id, roll_no, student_name, class, section, academic_month, amount_due, amount_paid, print_mode, issued_by)
              VALUES (${paymentId}, ${student_id}, ${paymentRow.roll_no}, ${studentName},
                      ${paymentRow.class}, ${paymentRow.section}, ${academic_month}::DATE,
                      ${paymentRow.amount_due}, ${paymentRow.this_payment_amount},
                      ${printMode}, ${issuedBy})
              RETURNING receipt_no
            `;
        receiptNo = receiptInsert[0] ? receiptInsert[0].receipt_no : null;
      }

      return { notFound: false as const, payment: paymentRow, receiptNo };
    });

    if (result.notFound) {
      return NextResponse.json({ error: 'Student not found.' }, { status: 404 });
    }

    const payment = result.payment;
    if (payment) (payment as any).receipt_no = result.receiptNo;

    if (payment && payment.email && Number(payment.amount_paid) > 0) {
      const formattedMonth = formatAcademicMonth(payment.academic_month);
      const paymentDate = formatPaymentDate(payment.payment_date);

      const subject = `Fee Payment Receipt — ${payment.first_name} ${payment.last_name}`;
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.5;">
          <h2 style="color:#2b6cb0;">Fee Payment Receipt</h2>
          <p>Dear ${payment.first_name} ${payment.last_name},</p>
          <p>Thank you for your fee payment. Below are the details for the payment recorded for <strong>${formattedMonth}</strong>:</p>
          <table style="width:100%;border-collapse:collapse;margin-top:16px;">
            <tr><td style="padding:8px;border:1px solid #ddd;">Student Name</td><td style="padding:8px;border:1px solid #ddd;">${payment.first_name} ${payment.last_name}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;">Roll No.</td><td style="padding:8px;border:1px solid #ddd;">${payment.roll_no}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;">Class / Section</td><td style="padding:8px;border:1px solid #ddd;">${payment.class} / ${payment.section}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;">Payment Date</td><td style="padding:8px;border:1px solid #ddd;">${paymentDate}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;">This Payment</td><td style="padding:8px;border:1px solid #ddd;">${formatCurrency(payment.this_payment_amount)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;">Amount Due (${formattedMonth})</td><td style="padding:8px;border:1px solid #ddd;">${formatCurrency(payment.amount_due)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;">Total Paid (${formattedMonth})</td><td style="padding:8px;border:1px solid #ddd;">${formatCurrency(payment.amount_paid)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;">Balance</td><td style="padding:8px;border:1px solid #ddd;">${formatCurrency(payment.balance)}</td></tr>
          </table>
          <p style="margin-top:16px;">If you have any questions or need further assistance, please contact the school office.</p>
          <p style="margin-top:8px;">Sincerely,<br/>School Administration</p>
        </div>`;
      const text = `Fee Payment Receipt\n\nStudent: ${payment.first_name} ${payment.last_name}\nRoll No: ${payment.roll_no}\nClass/Section: ${payment.class} / ${payment.section}\nPayment Date: ${paymentDate}\nThis Payment: ${formatCurrency(payment.this_payment_amount)}\nAmount Due (${formattedMonth}): ${formatCurrency(payment.amount_due)}\nTotal Paid (${formattedMonth}): ${formatCurrency(payment.amount_paid)}\nBalance: ${formatCurrency(payment.balance)}\n\nThank you for your payment.`;

      sendMail({ to: payment.email, subject, text, html }).catch((err) =>
        console.warn('Email send failed:', err.message)
      );
    }

    broadcast('fees.changed', { action: 'added', payment_id: payment?.payment_id });
    return NextResponse.json({ message: 'Fee payment recorded.', payment }, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}

/* ─────────────────────────────────────────
   GET /api/fees — optional ?month=&class=&search=&gender=
   Ported from routes/fees.js `GET /` (near bottom of file).
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = req.nextUrl;
    const month = searchParams.get('month');
    const cls = searchParams.get('class');
    const search = searchParams.get('search');
    const gender = searchParams.get('gender');

    const conditions: Prisma.Sql[] = [];
    if (month) {
      const normalizedMonth = normalizeMonthInput(month) || month;
      conditions.push(Prisma.sql`AND DATE_TRUNC('month', fp.academic_month) = DATE_TRUNC('month', ${normalizedMonth}::DATE)`);
    }
    if (cls) conditions.push(Prisma.sql`AND s.class = ${cls}`);
    if (gender) conditions.push(Prisma.sql`AND s.gender = ${gender}`);
    if (search) {
      const like = `%${search.toLowerCase()}%`;
      conditions.push(Prisma.sql`AND (
        LOWER(s.first_name) LIKE ${like} OR
        LOWER(s.last_name) LIKE ${like} OR
        CAST(s.roll_no AS TEXT) LIKE ${like}
      )`);
    }

    const whereExtra = conditions.length
      ? Prisma.join(conditions, ' ', ' ')
      : Prisma.empty;

    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        MAX(fp.payment_id) AS payment_id,
        fp.student_id,
        DATE_TRUNC('month', fp.academic_month)::date AS academic_month,
        SUM(fp.amount_due)  AS amount_due,
        SUM(fp.amount_paid) AS amount_paid,
        MAX(fp.payment_date) AS payment_date,
        COUNT(*) AS payment_count,
        s.roll_no, s.first_name, s.last_name, s.class, s.section, s.photo_url, s.gender
      FROM fee_payments fp
      JOIN students s ON s.student_id = fp.student_id
      WHERE 1=1
      ${whereExtra}
      GROUP BY fp.student_id, DATE_TRUNC('month', fp.academic_month), s.roll_no,
               s.first_name, s.last_name, s.class, s.section, s.photo_url, s.gender
      ORDER BY DATE_TRUNC('month', fp.academic_month) DESC, s.class, s.section, s.roll_no
    `;

    const shaped = rows.map((r) => ({
      ...r,
      payment_count: parseInt(r.payment_count.toString(), 10),
    }));

    return NextResponse.json({ count: shaped.length, payments: shaped });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}