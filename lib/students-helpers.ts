// lib/students-helpers.ts — ported verbatim from routes/students.js

export const allowedClasses = new Set([
  'playgroup', 'nursery', 'prep',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
]);

export function normalizeMonthInput(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw.slice(0, 7)}-01`;
  return null;
}

export function getClassRollStart(_normalizedClass: string): number {
  return 1;
}

/**
 * Accepts 'male'/'female' case-insensitively, plus common shorthand
 * ('m'/'f', 'boy'/'girl'), and normalizes to the two canonical values the
 * DB CHECK constraint allows. Returns null for empty/unset input (meaning
 * "not specified" — a valid, allowed state) and for anything unrecognized.
 */
export function normalizeGenderInput(value: unknown): 'male' | 'female' | null {
  if (value == null || value === '') return null;
  const raw = String(value).trim().toLowerCase();
  if (raw === 'male' || raw === 'm' || raw === 'boy') return 'male';
  if (raw === 'female' || raw === 'f' || raw === 'girl') return 'female';
  return null;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Normalizes a Pakistani phone number into the stored dash format,
 * accepting free-form user input (digits only, or already dashed).
 *   - Mobile numbers: 11 digits starting with '03' -> '03xx-xxxxxxx'
 *     (3-digit prefix, 7-digit rest — matches the '03xx-xxxxxxx' shape).
 *   - Landline numbers: 7 digits after a '051' area code -> '051-xxxxxxx'
 *     (also accepts other common area codes of the same length pattern
 *     when explicitly provided with dashes, e.g. '042-xxxxxxx').
 * Any input that doesn't match a recognized shape is returned trimmed
 * and unchanged (with dashes/spaces collapsed to a single dash where
 * digits were separated), so existing/free-form data is never dropped
 * or rejected — this is a best-effort normalizer, not a hard validator.
 */
export function normalizePhoneInput(value: unknown): string {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';

  // Pull out just the digits to reason about shape; keep a fallback of
  // the original trimmed value in case nothing recognizable is found.
  const digits = raw.replace(/[^\d]/g, '');

  // 11-digit mobile number starting with 03 -> 03xx-xxxxxxx (4-7 split).
  if (/^03\d{9}$/.test(digits)) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }

  // Landline: optional 3-digit area code (e.g. 051) + 7-digit number.
  // Accept either 10 digits total (area code + 7-digit number) or a
  // bare 7-digit number (area code omitted, e.g. already local).
  if (/^\d{3}\d{7}$/.test(digits) && digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  if (/^\d{7}$/.test(digits)) {
    return digits.replace(/^(\d{3})(\d{4})$/, '$1-$2');
  }

  // Already in an acceptable dashed format matching one of the two
  // shapes (03xx-xxxxxxx or 0xx-xxxxxxx) — pass through as-is.
  if (/^03\d{2}-\d{7}$/.test(raw) || /^0\d{2}-\d{7}$/.test(raw)) {
    return raw;
  }

  // Unrecognized shape (e.g. international number, extension, etc.) —
  // don't reject or mangle it, just pass the trimmed value through.
  return raw;
}
