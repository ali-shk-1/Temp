/**
 * lib/db-admin/helpers.ts
 *
 * Shared helpers for the DB admin viewer route handlers
 * (app/api/db-admin/**). Kept separate from table-registry.ts so the
 * allowlist itself stays a plain, easily-audited data file.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { TableRegistryEntry } from './table-registry';

/**
 * Composite PKs are passed on the URL as a single path segment. Encode as
 * JSON of the field->value map (ordered per entry.pk) then base64url, so
 * it's a single opaque URL-safe token regardless of value types/content
 * (dates, strings with slashes, etc. all survive round-trip safely).
 */
export function encodePk(entry: TableRegistryEntry, row: Record<string, any>): string {
  const obj: Record<string, any> = {};
  for (const field of entry.pk) obj[field] = row[field];
  const json = JSON.stringify(obj);
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodePk(entry: TableRegistryEntry, token: string): Record<string, any> {
  let obj: Record<string, any>;
  try {
    obj = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Malformed row identifier.');
  }
  for (const field of entry.pk) {
    if (!(field in obj)) throw new Error('Malformed row identifier.');
  }
  return obj;
}

/** Builds a Prisma `where` uniquely identifying one row, honoring composite PKs (Prisma's compound-@@id field name convention: field1_field2). */
export function pkWhere(entry: TableRegistryEntry, pkValues: Record<string, any>): Record<string, any> {
  if (entry.pk.length === 1) {
    const field = entry.pk[0];
    return { [field]: pkValues[field] };
  }
  const compoundName = entry.pk.join('_');
  const compoundValue: Record<string, any> = {};
  for (const field of entry.pk) compoundValue[field] = pkValues[field];
  return { [compoundName]: compoundValue };
}

/** Strips excluded columns from a row before it's ever sent to the client. */
export function stripExcluded(entry: TableRegistryEntry, row: Record<string, any>): Record<string, any> {
  if (!entry.excludeColumns?.length) return row;
  const copy = { ...row };
  for (const col of entry.excludeColumns) delete copy[col];
  return copy;
}

/**
 * Serializes a row for JSON transport: Decimal -> number, Date -> ISO
 * string for @db.Timestamp fields or 'YYYY-MM-DD' for @db.Date fields
 * (matching the rest of the app's lib/date-format.ts convention),
 * BigInt -> number. Applied after stripExcluded.
 */
export function serializeRow(
  entry: TableRegistryEntry,
  row: Record<string, any>,
  dateOnlyFields: Set<string>
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Prisma.Decimal) {
      out[key] = Number(value);
    } else if (typeof value === 'bigint') {
      out[key] = Number(value);
    } else if (value instanceof Date) {
      out[key] = dateOnlyFields.has(key) ? toDateOnlyString(value) : value.toISOString();
    } else {
      out[key] = value;
    }
  }
  return out;
}

function toDateOnlyString(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface FieldMeta {
  name: string;
  /** Prisma scalar type, e.g. 'Int', 'String', 'DateTime', 'Decimal', 'Boolean' */
  type: string;
  /** true for @db.Date fields specifically (vs full-timestamp DateTime) */
  isDateOnly: boolean;
  isRequired: boolean;
  isId: boolean;
  isReadOnly: boolean; // relation fields, or fields with @default(autoincrement())
  isList: boolean;
  /** relation field name this FK points through, if this is a foreign scalar key */
  relationName?: string;
}

const dmmfCache = new Map<string, FieldMeta[]>();

/**
 * Introspects field metadata for a Prisma model via Prisma.dmmf, rather
 * than hand-maintaining a parallel type map. Stays correct automatically
 * if the schema changes. dateOnlyFields is derived from this (native type
 * === 'Date').
 */
export function getFieldMeta(prismaModelName: string): FieldMeta[] {
  const cached = dmmfCache.get(prismaModelName);
  if (cached) return cached;

  const dmmfModel = (Prisma as any).dmmf.datamodel.models.find(
    (m: any) => m.name[0].toLowerCase() + m.name.slice(1) === prismaModelName
  );
  if (!dmmfModel) throw new Error(`Unknown Prisma model: ${prismaModelName}`);

  const fields: FieldMeta[] = dmmfModel.fields
    .filter((f: any) => f.kind !== 'object') // drop relation fields (e.g. `staff`, `designation`) — scalars + FK ids only
    .map((f: any) => {
      const nativeType: string | undefined = f.nativeType?.[0];
      return {
        name: f.name,
        type: f.type,
        isDateOnly: f.type === 'DateTime' && nativeType === 'Date',
        isRequired: f.isRequired && !f.hasDefaultValue,
        isId: f.isId,
        isReadOnly: f.isId && f.hasDefaultValue, // autoincrement PKs are not editable
        isList: !!f.isList,
      };
    });
  dmmfCache.set(prismaModelName, fields);
  return fields;
}

export function dateOnlyFieldSet(prismaModelName: string): Set<string> {
  return new Set(getFieldMeta(prismaModelName).filter((f) => f.isDateOnly).map((f) => f.name));
}

/**
 * Coerces a raw JSON edit payload into properly-typed values per field
 * (Decimal/number strings -> Prisma.Decimal-safe types, date strings ->
 * Date, booleans, etc.), and drops any key not present on the model or
 * explicitly excluded/read-only. Never trusts client-supplied types.
 */
export function coerceEditPayload(
  entry: TableRegistryEntry,
  fields: FieldMeta[],
  body: Record<string, any>
): Record<string, any> {
  const excluded = new Set(entry.excludeColumns || []);
  const byName = new Map(fields.map((f) => [f.name, f]));
  const data: Record<string, any> = {};

  for (const [key, rawValue] of Object.entries(body)) {
    if (excluded.has(key)) continue;
    if (entry.pk.includes(key)) continue; // PK is never editable via this payload
    const meta = byName.get(key);
    if (!meta || meta.isReadOnly) continue;

    if (rawValue === null || rawValue === '') {
      data[key] = null;
      continue;
    }

    switch (meta.type) {
      case 'Int':
        data[key] = parseInt(String(rawValue), 10);
        break;
      case 'Float':
        data[key] = parseFloat(String(rawValue));
        break;
      case 'Decimal':
        data[key] = new Prisma.Decimal(String(rawValue));
        break;
      case 'Boolean':
        data[key] = typeof rawValue === 'boolean' ? rawValue : rawValue === 'true' || rawValue === '1';
        break;
      case 'DateTime':
        data[key] = new Date(String(rawValue));
        break;
      default:
        data[key] = rawValue;
    }
  }
  return data;
}

/** Returns the Prisma model delegate for a registry entry, e.g. prisma.student. */
export function getDelegate(entry: TableRegistryEntry): any {
  return (prisma as any)[entry.prismaModel];
}
