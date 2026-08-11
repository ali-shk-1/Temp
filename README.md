# School Management System

Next.js (App Router) + TypeScript + Prisma port of the original Express/vanilla‑JS
school management app. This README covers everything needed to get a fresh
checkout running: environment variables, install, Prisma setup (including the
two manual raw‑SQL constraints Prisma's schema DSL can't express), seeding
accounts, and day‑to‑day run commands.

## 1. Requirements

- Node.js 18.18+ (Next.js 16 requirement)
- A PostgreSQL 14+ database (the schema was confirmed against a real
  PostgreSQL 18.4 `pg_dump` — see the comment block at the top of
  `prisma/schema.prisma`)
- npm (or another package manager — examples below use npm)

## 2. Environment variables

Create a `.env` file at the project root (same folder as `package.json`):

```bash
# Database — standard Prisma connection string
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE_NAME"

# Auth (JWT)
JWT_SECRET="replace-with-a-long-random-string"
JWT_EXPIRES_IN="8h"                 # optional, defaults to 8h if omitted

# Outgoing email (optional — if SMTP_HOST/SMTP_PORT are omitted, the app
# logs a warning and skips sending mail instead of failing)
SMTP_HOST=""
SMTP_PORT=""
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM="School Administration <no-reply@school.local>"
SMTP_SECURE=""                      # "true"/"1" to force TLS; auto-true for port 465
```

`NODE_ENV` is set automatically by the `npm run dev` / `npm run build` /
`npm start` scripts — you don't need to set it yourself. (`NODE_ENV=test`
disables outgoing email entirely, used by the test suite if/when one is
added.)

## 3. Install dependencies

```bash
npm install
```

`node_modules` is intentionally not shipped in any handoff zip — always run
this after a fresh checkout or merge.

## 4. Database setup

### 4a. Point Prisma at your database

Make sure `DATABASE_URL` above is set and the database exists (Prisma does
not create the database itself).

### 4b. Apply the schema

```bash
npx prisma migrate deploy   # if you already have migration files checked in
# — or, for a brand-new database with no migration history yet —
npx prisma db push
```

### 4c. Apply the two manual raw-SQL constraints

Prisma's schema DSL cannot express two constraints that exist in the real
database (documented in detail at the top of `prisma/schema.prisma`). Run
these once, directly against the database, after the schema above is
applied:

```sql
-- 1. Functional unique index (COALESCE on gender, not a plain column list)
CREATE UNIQUE INDEX students_class_section_gender_roll_no_unique
  ON students (class, section, COALESCE(gender, 'unspecified'), roll_no);

-- 2. CHECK constraints restricting gender to NULL / 'male' / 'female'
ALTER TABLE students ADD CONSTRAINT students_gender_check
  CHECK (gender IS NULL OR gender IN ('male','female'));

ALTER TABLE left_students ADD CONSTRAINT left_students_gender_check
  CHECK (gender IS NULL OR gender IN ('male','female'));
```

(Optional, cosmetic only: the real database also happens to have two
separate, identically-behaving UNIQUE constraints on `staff.cnic`
— `staff_cnic_key` and `staff_cnic_unique` — a historical duplicate. Prisma's
`@unique` only produces one of them. This has no effect on app behavior, so
it's safe to leave as-is; only recreate the duplicate manually if you need
byte-identical constraint names to the original database.)

After applying the above, refresh Prisma's view of the schema and generate
the client:

```bash
npx prisma db pull      # confirms Prisma sees the constraints (optional, sanity check)
npx prisma generate     # required — the client isn't checked into the repo
```

> **Note:** `npx prisma generate` must be run on your own machine / server.
> It wasn't runnable inside the sandbox these ports were built in (no
> network access to `binaries.prisma.sh`), which is why earlier handoffs
> show `@prisma/client`-related TypeScript errors in `app/api/*` and
> `lib/{apiHandler,prisma,mailer}.ts` — those disappear once you run this
> command locally.

## 5. Seed initial accounts

All account-creation scripts live in `scripts/` and are thin Prisma ports of
the original `backend/*.js` scripts (same behavior, same default
usernames/passwords, same "safe to re-run" semantics — re-running any of
them just resets the password and role rather than erroring or duplicating).

Run once, in order, against a fresh database:

```bash
npm run seed                # roles, designations, expense categories, admin + principal accounts
npm run create:ali-viewer   # ali (top-level) + viewer accounts, plus default role_permissions rows
npm run create:vice-principal   # optional — vice_principal account
npm run create:accountant       # optional — accountant account
```

`npm run create:principal` is also available if you ever need to recreate or
rename the principal account outside of `seed`'s defaults — each of the
`create:*` scripts accepts optional `username password` arguments, e.g.:

```bash
node scripts/create-principal.js headmaster MySecurePass123
```

### Default credentials created by the scripts above

| Script | Username | Password |
|---|---|---|
| `npm run seed` | `admin` | `Admin@123` |
| `npm run seed` | `principal` | `Principal@123` |
| `npm run create:ali-viewer` | `ali` | `123#Ali123` |
| `npm run create:ali-viewer` | `viewer` | `Viewer@123` |
| `npm run create:vice-principal` | `vp` | `Vp@123` |
| `npm run create:accountant` | `accountant` | `Acc@123` |

**Change every one of these passwords after first login** (via
`POST /api/auth/change-password`, or from the Permissions page as `ali`) —
each script prints this reminder when it runs.

If you ever need to reset the `admin` account's password back to the
default without touching anything else:

```bash
npm run reset:admin
```

## 6. Run the app

```bash
npm run dev      # development server, http://localhost:3000
npm run build    # production build
npm start        # run the production build (after `npm run build`)
```

`app/page.tsx` redirects `/` to `/dashboard` or `/login` depending on
whether an auth token is present.

## 7. Project layout (high level)

- `app/api/*` — all 50 backend routes (auth, students, staff, fees,
  expenses, dashboard, permissions), ported 1:1 from the original Express
  routes.
- `app/*` (everything else) — the frontend pages, one per original HTML
  file (`students.html` → `app/students/page.tsx`, etc.), each wrapped in
  `components/AuthedPage.tsx` for the shared auth-guard/permissions/nav/toast
  boilerplate.
- `lib/` — shared frontend helpers (`api-client.ts`, `permissions-client.ts`,
  `useLiveUpdates.ts`, `theme.ts`, `toast.ts`, `useAuthGuard.ts`) and backend
  helpers (`apiHandler.ts`, `prisma.ts`, `auth.ts`, `permissions.ts`,
  `mailer.ts`, `uploads.ts`).
- `prisma/schema.prisma` — the full data model, confirmed against a real
  `pg_dump` (see the comment block at the top of that file for details and
  the raw-SQL constraints from step 4c above).
- `scripts/` — one-off Node scripts for seeding/creating accounts (see
  section 5).

## 8. Troubleshooting

- **TypeScript errors mentioning `@prisma/client` in `app/api/*` or
  `lib/apiHandler.ts` / `lib/prisma.ts` / `lib/mailer.ts`** — run
  `npx prisma generate` (see step 4). These are expected until then and
  don't indicate a bug in the route code itself.
- **`next build` fails at the type-check step but shows
  "✓ Compiled successfully" first** — same cause as above; the compile step
  passing confirms there are no route collisions or JSX/import errors, only
  the pending Prisma-generation step.
- **Login works but every button looks hidden / permission-gated
  controls don't show up** — make sure `npm run create:ali-viewer` has been
  run at least once (it seeds the `role_permissions` defaults for `viewer`,
  `admin`, and `principal`), and that the account you're testing with has an
  `is_active = true` row.
