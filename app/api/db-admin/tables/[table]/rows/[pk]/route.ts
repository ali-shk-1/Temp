import { NextRequest, NextResponse } from 'next/server';
import { authenticate, authorizeRoles } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { getTableEntry } from '@/lib/db-admin/table-registry';
import { broadcast } from '@/lib/sse';
import {
  getDelegate,
  getFieldMeta,
  dateOnlyFieldSet,
  serializeRow,
  stripExcluded,
  decodePk,
  pkWhere,
  coerceEditPayload,
  encodePk,
} from '@/lib/db-admin/helpers';

/* ─────────────────────────────────────────
   PUT /api/db-admin/tables/[table]/rows/[pk]
   Ali-only. Inline row edit. Never accepts the PK itself or any
   excluded/read-only column from the client — see coerceEditPayload.
───────────────────────────────────────── */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ table: string; pk: string }> }
) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = authorizeRoles(auth.user, 'ali');
  if (denied) return denied;

  try {
    const { table, pk } = await params;
    const entry = getTableEntry(table);
    if (!entry) {
      return NextResponse.json({ error: `Unknown or non-browsable table: ${table}` }, { status: 404 });
    }

    let pkValues: Record<string, any>;
    try {
      pkValues = decodePk(entry, pk);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }

    const body = await req.json();
    const fields = getFieldMeta(entry.prismaModel);
    const data = coerceEditPayload(entry, fields, body);

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No editable fields supplied.' }, { status: 400 });
    }

    const delegate = getDelegate(entry);
    const updated = await delegate.update({
      where: pkWhere(entry, pkValues),
      data,
    });

    const dateOnly = dateOnlyFieldSet(entry.prismaModel);
    const stripped = stripExcluded(entry, updated);
    const serialized = serializeRow(entry, stripped, dateOnly);

    broadcast('db-admin.changed', { table: entry.dbTable, action: 'updated' });

    return NextResponse.json({
      message: 'Row updated.',
      row: { ...serialized, __pk: encodePk(entry, updated) },
    });
  } catch (err) {
    return handleApiError(err, 'PUT');
  }
}

/* ─────────────────────────────────────────
   DELETE /api/db-admin/tables/[table]/rows/[pk]
   Ali-only. Relies on handleApiError's existing P2003 handling to give a
   clear "still referenced by other data" message if a FK blocks it.
───────────────────────────────────────── */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ table: string; pk: string }> }
) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = authorizeRoles(auth.user, 'ali');
  if (denied) return denied;

  try {
    const { table, pk } = await params;
    const entry = getTableEntry(table);
    if (!entry) {
      return NextResponse.json({ error: `Unknown or non-browsable table: ${table}` }, { status: 404 });
    }

    let pkValues: Record<string, any>;
    try {
      pkValues = decodePk(entry, pk);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }

    const delegate = getDelegate(entry);
    await delegate.delete({ where: pkWhere(entry, pkValues) });

    broadcast('db-admin.changed', { table: entry.dbTable, action: 'deleted' });

    return NextResponse.json({ message: 'Row deleted.' });
  } catch (err) {
    return handleApiError(err, 'DELETE');
  }
}
