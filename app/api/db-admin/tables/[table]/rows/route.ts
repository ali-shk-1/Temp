import { NextRequest, NextResponse } from 'next/server';
import { authenticate, authorizeRoles } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { getTableEntry } from '@/lib/db-admin/table-registry';
import {
  getDelegate,
  getFieldMeta,
  dateOnlyFieldSet,
  serializeRow,
  stripExcluded,
  encodePk,
} from '@/lib/db-admin/helpers';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/* ─────────────────────────────────────────
   GET /api/db-admin/tables/[table]/rows
     ?page=1&pageSize=50&search=foo&sort=field&dir=asc
   Ali-only. Paginated row browser for one allowlisted table.
───────────────────────────────────────── */
export async function GET(req: NextRequest, { params }: { params: Promise<{ table: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = authorizeRoles(auth.user, 'ali');
  if (denied) return denied;

  try {
    const { table } = await params;
    const entry = getTableEntry(table);
    if (!entry) {
      return NextResponse.json({ error: `Unknown or non-browsable table: ${table}` }, { status: 404 });
    }

    const { searchParams } = req.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE)
    );
    const search = searchParams.get('search')?.trim() || '';
    const sortField = searchParams.get('sort') || entry.pk[0];
    const sortDir = searchParams.get('dir') === 'desc' ? 'desc' : 'asc';

    const fields = getFieldMeta(entry.prismaModel);
    const fieldNames = new Set(fields.map((f) => f.name));
    const dateOnly = dateOnlyFieldSet(entry.prismaModel);
    const delegate = getDelegate(entry);

    // Simple case-insensitive OR-across-string-columns search, mirroring
    // the ILIKE-across-columns pattern used elsewhere in this app.
    let where: Record<string, any> | undefined;
    if (search) {
      const stringFields = fields.filter((f) => f.type === 'String').map((f) => f.name);
      if (stringFields.length) {
        where = { OR: stringFields.map((f) => ({ [f]: { contains: search, mode: 'insensitive' } })) };
      }
    }

    const orderBy = fieldNames.has(sortField) ? { [sortField]: sortDir } : { [entry.pk[0]]: sortDir };

    const [total, rows] = await Promise.all([
      delegate.count({ where }),
      delegate.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const shaped = rows.map((row: Record<string, any>) => {
      const stripped = stripExcluded(entry, row);
      const serialized = serializeRow(entry, stripped, dateOnly);
      return { ...serialized, __pk: encodePk(entry, row) };
    });

    const columns = fields
      .filter((f) => !entry.excludeColumns?.includes(f.name))
      .map((f) => ({
        name: f.name,
        type: f.type,
        isDateOnly: f.isDateOnly,
        isRequired: f.isRequired,
        isPk: entry.pk.includes(f.name),
        isReadOnly: f.isReadOnly || entry.pk.includes(f.name),
      }));

    return NextResponse.json({
      table: entry.dbTable,
      label: entry.label,
      columns,
      rows: shaped,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
