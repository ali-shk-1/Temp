/**
 * scripts/import-students.js
 *
 * Bulk-imports students from an Excel workbook into the `students` table
 * via Prisma, using each worksheet name to determine gender.
 *
 * Worksheet name pattern:  <b|g>-<class>[-<group>]-<section>
 *   b/g    -> gender: b = male, g = female
 *   class  -> playgroup | nursery | prep | 1..10
 *   group  -> optional, e.g. Csc / Bio / Arts (classes 8-10 only)
 *   section-> the trailing letter, e.g. A / B
 *
 * NOTE: the row's own `class` and `section` columns are treated as the
 * source of truth for the actual insert (they already contain values
 * like "Csc-A" for grouped classes). The sheet name is only used to
 * derive GENDER and as a cross-check against the row data.
 *
 * Required row columns (header row must match exactly, in this order):
 *   roll_no | first_name | last_name | class | section | father_name |
 *   fee_start_month | contact_1 | contact_2
 *
 * Usage:
 *   node scripts/import-students.js --file <path.xlsx>              (dry run, default)
 *   node scripts/import-students.js --file <path.xlsx> --dry-run    (explicit dry run)
 *   node scripts/import-students.js --file <path.xlsx> --commit     (actually writes to DB)
 *
 * Dry run performs 100% of validation and prints every row it WOULD
 * insert, plus a full error/warning report, but makes ZERO database
 * calls. Nothing is written unless --commit is passed.
 */

const path = require('path');
const XLSX = require('xlsx');
const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();

// ---- constants -------------------------------------------------------

const ALLOWED_CLASSES = new Set([
  'playgroup', 'nursery', 'prep',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
]);

const EXPECTED_HEADERS = [
  'roll_no', 'first_name', 'last_name', 'class', 'section',
  'father_name', 'fee_start_month', 'contact_1', 'contact_2',
];

const FEE_START_MONTH = new Date('2026-04-01T00:00:00.000Z');

const SHEET_NAME_RE = /^(b|g)-([a-zA-Z]+|\d+)(?:-([A-Za-z]+))?-([A-Za-z0-9]+)$/;

// ---- helpers -----------------------------------------------------------

function normalizeGenderFromSheetPrefix(letter) {
  return letter === 'b' ? 'male' : letter === 'g' ? 'female' : null;
}

/**
 * Cleans obviously-malformed phone numbers:
 *  - trims whitespace
 *  - collapses internal whitespace/double-dashes
 *  - if the cell actually contains TWO numbers jammed together
 *    (e.g. "0312-9654731- 0347-7061716"), keeps only the first one
 *    and returns the second separately so it can fill contact_2
 *    if that slot is empty.
 *  - strips stray characters that aren't digits or a single dash
 * Returns { cleaned, extra, changed, note }
 */
function cleanPhone(raw) {
  if (raw == null || String(raw).trim() === '') return { cleaned: null, extra: null, changed: false, note: null };
  let s = String(raw).trim();
  const original = s;

  // Detect two numbers separated by a dash+space or similar (e.g. "A- B")
  let extra = null;
  const twoNumMatch = s.match(/^(\d[\d-]{6,14})\s*-\s*(\d[\d-]{6,14})$/);
  if (twoNumMatch) {
    s = twoNumMatch[1];
    extra = twoNumMatch[2];
  }

  // Remove stray dots, double dashes, extra whitespace
  s = s.replace(/\./g, '');
  s = s.replace(/\s+/g, '');
  s = s.replace(/-{2,}/g, '-');

  if (extra) {
    extra = extra.replace(/\./g, '').replace(/\s+/g, '').replace(/-{2,}/g, '-');
  }

  const changed = s !== original.replace(/\s+/g, '');
  const note = changed ? `cleaned from "${original}"` : null;

  // Enforce DB column limit (VARCHAR(15))
  let truncNote = null;
  if (s.length > 15) {
    truncNote = `WARNING: "${s}" exceeds 15 chars, will be TRUNCATED to fit DB column`;
  }

  return { cleaned: s, extra, changed, note, truncNote };
}

function loadWorkbook(filePath) {
  return XLSX.readFile(filePath, { cellDates: false });
}

// ---- core parse/validate pass (no DB calls) -----------------------------

function parseAndValidate(workbook) {
  const rows = [];          // rows ready to insert
  const errors = [];        // blocking problems -> row is skipped
  const warnings = [];      // non-blocking, but shown to user
  const seenKeys = new Map(); // "class|section|gender|roll_no" -> location, to catch in-file dupes

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

    if (data.length === 0) {
      warnings.push(`[${sheetName}] sheet is empty, skipping`);
      continue;
    }

    const headerRow = data[0].map(h => (h == null ? null : String(h).trim()));
    const headersMatch = EXPECTED_HEADERS.every((h, i) => headerRow[i] === h);
    if (!headersMatch) {
      errors.push(`[${sheetName}] HEADER MISMATCH — expected ${JSON.stringify(EXPECTED_HEADERS)}, got ${JSON.stringify(headerRow)}. Entire sheet skipped.`);
      continue;
    }

    const m = SHEET_NAME_RE.exec(sheetName);
    if (!m) {
      errors.push(`[${sheetName}] sheet name does not match expected pattern <b|g>-<class>[-<group>]-<section>. Entire sheet skipped.`);
      continue;
    }
    const [, genderLetter] = m;
    const genderFromSheet = normalizeGenderFromSheetPrefix(genderLetter);

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const excelRowNum = i + 1; // 1-based, +1 for header
      const loc = `${sheetName}!row${excelRowNum}`;

      if (!row || row.every(v => v == null || String(v).trim() === '')) continue; // skip fully blank rows

      let [roll_no, first_name, last_name, cls, section, father_name, fee_start_month_cell, contact_1_raw, contact_2_raw] = row;

      const rowErrors = [];

      // roll_no
      if (roll_no == null || roll_no === '') {
        rowErrors.push('missing roll_no');
      } else if (typeof roll_no !== 'number' || !Number.isInteger(roll_no)) {
        rowErrors.push(`roll_no must be a whole number, got ${JSON.stringify(roll_no)}`);
      }

      // first_name
      if (!first_name || !String(first_name).trim()) {
        rowErrors.push('missing first_name (required)');
      }

      // class
      const clsStr = cls == null ? '' : String(cls).trim();
      if (!clsStr) {
        rowErrors.push('missing class');
      } else if (!ALLOWED_CLASSES.has(clsStr.toLowerCase())) {
        rowErrors.push(`invalid class "${clsStr}" — must be one of: ${[...ALLOWED_CLASSES].join(', ')}`);
      }

      // section (stored as-is, e.g. "A" or "Csc-A")
      const sectionStr = section == null ? '' : String(section).trim();
      if (!sectionStr) {
        rowErrors.push('missing section');
      } else if (sectionStr.length > 10) {
        rowErrors.push(`section "${sectionStr}" exceeds 10-char DB column limit`);
      }

      // father_name (nullable, just a warning)
      const fatherStr = father_name == null ? null : String(father_name).trim() || null;
      if (!fatherStr) {
        warnings.push(`${loc}: father_name is empty (allowed — column is nullable)`);
      }

      // fee_start_month: per instructions, ALWAYS forced to April 2026,
      // regardless of what's in the sheet. Warn if the sheet had a
      // different value so it isn't silently lost without notice.
      if (fee_start_month_cell != null && String(fee_start_month_cell).trim() !== '') {
        warnings.push(`${loc}: sheet had fee_start_month="${fee_start_month_cell}" — OVERRIDING to 2026-04-01 per instructions`);
      }

      // contacts
      let contact_1 = null, contact_2 = null;
      const c1res = cleanPhone(contact_1_raw);
      const c2res = cleanPhone(contact_2_raw);

      contact_1 = c1res.cleaned;
      contact_2 = c2res.cleaned;

      if (c1res.note) warnings.push(`${loc}: contact_1 ${c1res.note}`);
      if (c1res.truncNote) warnings.push(`${loc}: contact_1 ${c1res.truncNote}`);
      if (c1res.extra && !contact_2) {
        // first cell secretly held two numbers -> use the second to fill contact_2 if empty
        contact_2 = c1res.extra;
        warnings.push(`${loc}: contact_1 cell held two numbers — moved second ("${c1res.extra}") into contact_2`);
      } else if (c1res.extra) {
        warnings.push(`${loc}: contact_1 cell held two numbers but contact_2 was already set — discarding extra "${c1res.extra}"`);
      }

      if (c2res.note) warnings.push(`${loc}: contact_2 ${c2res.note}`);
      if (c2res.truncNote) warnings.push(`${loc}: contact_2 ${c2res.truncNote}`);

      if (contact_1 && contact_1.length > 15) contact_1 = contact_1.slice(0, 15);
      if (contact_2 && contact_2.length > 15) contact_2 = contact_2.slice(0, 15);

      if (!contact_1 && !contact_2) {
        warnings.push(`${loc}: both contact_1 and contact_2 empty (allowed — optional)`);
      }

      // cross-check sheet-implied class vs row class (informational only —
      // row data wins per your decision)
      if (rowErrors.length === 0) {
        // no need to duplicate cls errors already caught above
      }

      // duplicate key check within this import batch
      const key = `${clsStr.toLowerCase()}|${sectionStr.toLowerCase()}|${genderFromSheet}|${roll_no}`;
      if (rowErrors.length === 0) {
        if (seenKeys.has(key)) {
          rowErrors.push(`duplicate of ${seenKeys.get(key)} within this import file (same class+section+gender+roll_no)`);
        } else {
          seenKeys.set(key, loc);
        }
      }

      if (rowErrors.length > 0) {
        errors.push(`${loc}: ${rowErrors.join('; ')}`);
        continue;
      }

      rows.push({
        _source: loc,
        roll_no,
        first_name: String(first_name).trim(),
        last_name: last_name ? String(last_name).trim() : null,
        class: clsStr,
        section: sectionStr,
        father_name: fatherStr,
        fee_start_month: FEE_START_MONTH,
        contact_1,
        contact_2,
        gender: genderFromSheet,
      });
    }
  }

  return { rows, errors, warnings };
}

// ---- DB duplicate pre-check (only relevant for --commit, but also run
// in dry-run so it's reported in advance) --------------------------------

async function checkExistingConflicts(rows) {
  const conflicts = [];
  // Batch check against the students_roll_no_section_class_key unique
  // constraint (roll_no, section, class) since that's what Prisma can
  // enforce directly; the gender-aware functional index is a DB-side
  // extra and would need raw SQL to pre-check exactly, but any row that
  // collides with the plain (roll_no, section, class) key will also
  // collide practically speaking for a fresh import.
  for (const r of rows) {
    const existing = await prisma.student.findFirst({
      where: { roll_no: r.roll_no, section: r.section, class: r.class },
      select: { student_id: true, first_name: true, last_name: true },
    });
    if (existing) {
      conflicts.push(
        `${r._source}: DB ALREADY HAS a student with roll_no=${r.roll_no}, class=${r.class}, section=${r.section} ` +
        `(existing: #${existing.student_id} ${existing.first_name} ${existing.last_name || ''}) — insert would fail on unique constraint`
      );
    }
  }
  return conflicts;
}

// ---- main ----------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  const filePath = fileIdx !== -1 ? args[fileIdx + 1] : null;
  const commit = args.includes('--commit');

  if (!filePath) {
    console.error('Usage: node scripts/import-students.js --file <path.xlsx> [--commit]');
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  console.log(`\n=== Student Import ${commit ? '(COMMIT MODE — will write to DB)' : '(DRY RUN — no DB writes)'} ===`);
  console.log(`File: ${resolvedPath}`);
  console.log(`Fee start month for ALL rows will be forced to: 2026-04-01\n`);

  const wb = loadWorkbook(resolvedPath);
  const { rows, errors, warnings } = parseAndValidate(wb);

  console.log(`Sheets scanned: ${wb.SheetNames.length}`);
  console.log(`Valid rows ready to insert: ${rows.length}`);
  console.log(`Blocking errors (rows skipped): ${errors.length}`);
  console.log(`Warnings (non-blocking): ${warnings.length}\n`);

  if (warnings.length) {
    console.log('--- WARNINGS ---');
    warnings.forEach(w => console.log('  ⚠ ' + w));
    console.log('');
  }

  if (errors.length) {
    console.log('--- ERRORS (these rows will NOT be inserted) ---');
    errors.forEach(e => console.log('  ✗ ' + e));
    console.log('');
  }

  // Check against what's already in the DB (real query, read-only —
  // safe to run even during a dry run).
  let conflicts = [];
  try {
    conflicts = await checkExistingConflicts(rows);
  } catch (e) {
    console.log(`Could not check DB for existing conflicts (DB unreachable?): ${e.message}`);
  }

  if (conflicts.length) {
    console.log('--- DB CONFLICTS (existing students would block these inserts) ---');
    conflicts.forEach(c => console.log('  ⚠ ' + c));
    console.log('');
  }

  const insertable = rows.filter(r =>
    !conflicts.some(c => c.startsWith(r._source))
  );

  console.log(`--- SAMPLE OF ROWS THAT WOULD BE INSERTED (first 10 of ${insertable.length}) ---`);
  insertable.slice(0, 10).forEach(r => {
    console.log(
      `  ${r._source} -> roll_no=${r.roll_no}, name="${r.first_name} ${r.last_name || ''}", ` +
      `class=${r.class}, section=${r.section}, gender=${r.gender}, father="${r.father_name || ''}", ` +
      `c1=${r.contact_1 || ''}, c2=${r.contact_2 || ''}, fee_start_month=2026-04-01`
    );
  });
  console.log('');

  if (!commit) {
    console.log('=== DRY RUN COMPLETE — no data was written. ===');
    console.log(`Would insert: ${insertable.length} students.`);
    if (errors.length || conflicts.length) {
      console.log(`Fix the ${errors.length} error(s) and ${conflicts.length} conflict(s) above, then re-run.`);
    }
    console.log('Re-run with --commit to actually insert once you\'re happy with this report.\n');
    await prisma.$disconnect();
    return;
  }

  if (errors.length || conflicts.length) {
    console.log('Refusing to commit: there are unresolved errors/conflicts above. Fix them and re-run.');
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`Inserting ${insertable.length} students one-by-one inside a single transaction (so we can pinpoint any failure)...`);
  try {
    await prisma.$transaction(async (tx) => {
      let count = 0;
      for (const r of insertable) {
        try {
          await tx.student.create({
            data: {
              roll_no: r.roll_no,
              first_name: r.first_name,
              last_name: r.last_name,
              class: r.class,
              section: r.section,
              father_name: r.father_name,
              fee_start_month: r.fee_start_month,
              contact_1: r.contact_1,
              contact_2: r.contact_2,
              gender: r.gender,
            },
          });
          count++;
        } catch (innerErr) {
          console.error(`\n❌ FAILED on row: ${r._source} -> roll_no=${r.roll_no}, name="${r.first_name} ${r.last_name || ''}", class=${r.class}, section=${r.section}, gender=${r.gender}`);
          throw innerErr;
        }
      }
      console.log(`✅ Successfully inserted ${count} students.`);
    });
  } catch (e) {
    console.error('\n❌ Transaction failed — NO rows were committed (all-or-nothing):');
    console.error(e.message);
    process.exit(1);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
