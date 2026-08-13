# Part 3-B — phpMyAdmin-style DB Admin Viewer (built this session)

New feature, ali-only, gated the same way as `/permissions`
(`authorizeRoles(user, 'ali')` on the backend, `isAliUser()` redirect guard
on the frontend).

## Backend

- `lib/db-admin/table-registry.ts` — hand-maintained allowlist of the 14
  Prisma models exposed through the viewer, each with its Prisma accessor
  name, `@@map` table name, label, and PK field(s). `User.password_hash`
  is excluded here so it can never round-trip through the viewer.
- `lib/db-admin/helpers.ts`:
  - `encodePk`/`decodePk` — base64url-encoded JSON of the PK field→value
    map, so composite PKs (`role_permissions`, `role_page_visibility`)
    survive as a single URL path segment.
  - `pkWhere` — builds the Prisma `where` clause, handling Prisma's
    compound-`@@id` naming convention (`field1_field2`) for the two
    composite-key tables — confirmed against the exact same pattern
    already used in `app/api/permissions/[role]/route.ts`.
  - `getFieldMeta` — introspects column name/type/nullability/PK/
    read-only status via `Prisma.dmmf` rather than a hand-maintained type
    map, so it can't drift from the schema.
  - `coerceEditPayload` — converts a raw JSON edit body into properly
    typed Prisma `data`, allowlisting against the model's real fields
    and rejecting PK/excluded/read-only columns outright (defense in
    depth beyond the frontend hiding those inputs).
  - `serializeRow` — Decimal→number, BigInt→number, `@db.Date`→
    `'YYYY-MM-DD'` (reusing the Part 3-C date-only convention),
    full-timestamp `DateTime`→ISO string.
- Routes:
  - `GET /api/db-admin/tables` — list + live row counts.
  - `GET /api/db-admin/tables/[table]/rows` — paginated (default 50/page,
    max 200), optional `search` (case-insensitive OR across all string
    columns), optional `sort`/`dir`.
  - `PUT /api/db-admin/tables/[table]/rows/[pk]` — inline edit.
  - `DELETE /api/db-admin/tables/[table]/rows/[pk]` — delete; FK-violation
    errors already get a friendly message for free via the existing
    `handleApiError` P2003 handling.
  - Broadcasts `db-admin.changed` over SSE on write, matching the app's
    existing live-update pattern (no page currently subscribes to it,
    since this is the only page that needs to react to its own writes —
    added for consistency/future-proofing).

## Frontend

- `app/db-admin/page.tsx` — single page, `list`/`browse` view state.
  Table list → click a table → paginated row grid with click-to-sort
  headers, search box, Edit (modal) and Delete (confirm) per row.
  Uses only existing global CSS classes (`.card`, `.page-title`, `table`,
  `.btn-primary/.btn-secondary/.btn-danger`, `.modal-overlay/.modal`,
  `.search-box`) — no new stylesheet needed.
- `components/NavBar.tsx` — added a "DB Admin" link next to "Permissions",
  same `showPermissions` (i.e. `isAliUser()`) gate.

## Not done / follow-ups

- No dedicated "create new row" flow — scope was table list → row browser
  → inline edit/delete, per the original request. Could be added later
  as a `POST` route + a modal reusing the same column metadata.
- Build/type-check could not be run in this sandbox (no network access to
  `binaries.prisma.sh` for `prisma generate`, and `node_modules` isn't
  installed here). Verified by: brace-balance check on every new file,
  manual review against existing route/page conventions, and confirming
  the composite-PK naming assumption against real existing usage
  (`app/api/permissions/[role]/route.ts`). Recommend running
  `npm install && npx prisma generate && npm run build` before deploying.
