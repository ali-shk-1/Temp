/**
 * The original Express/pg backend installed a custom type parser
 * (types.setTypeParser(1082, val => val)) so that Postgres DATE columns
 * came back as raw 'YYYY-MM-DD' strings instead of being parsed into a
 * JS Date (which node-postgres would otherwise convert using the server's
 * local timezone, risking an off-by-one-day shift).
 *
 * Prisma's query builder (findMany/findUnique/create/update, etc. — NOT
 * $queryRaw, which already returns strings for DATE columns) has no
 * equivalent hook and always returns @db.Date fields as JS Date objects.
 * This helper formats those back into 'YYYY-MM-DD' strings using UTC
 * components (Prisma stores/returns @db.Date values at UTC midnight),
 * so the wire format exactly matches what the original sent.
 */
export function toDateOnlyString(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, '0');
  const d = String(value.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Shallow-shape an object, converting the named Date-valued keys to
 * 'YYYY-MM-DD' strings. Non-Date / null values pass through unchanged.
 */
export function withDateOnlyFields<T extends Record<string, any>>(
  obj: T,
  dateFields: (keyof T)[]
): T {
  const out: Record<string, any> = { ...obj };
  for (const field of dateFields) {
    if (field in out) {
      out[field as string] = toDateOnlyString(out[field as string]);
    }
  }
  return out as T;
}
