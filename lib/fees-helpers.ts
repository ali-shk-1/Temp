// lib/fees-helpers.ts — ported verbatim from routes/fees.js.
//
// NOTE: this normalizeMonthInput is intentionally DIFFERENT from the one in
// students-helpers.ts. The fees.js version:
//   - also unwraps an accidental '...-01-01' double-suffix (defensive against
//     a value that already had '-01' appended once passed back in)
//   - returns the RAW input unchanged if it doesn't match either pattern,
//     instead of returning null
// Keep these two helpers separate — do not consolidate them, the differing
// fallback behavior is relied upon by callers in both files.
export function normalizeMonthInput(value: unknown): string | null {
  if (!value) return null;
  let raw = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}-01$/.test(raw)) {
    raw = raw.slice(0, -3);
  }

  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return raw;
}
