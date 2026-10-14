# Track2 operations: backups, restore, health check, data-safety guards, Google sign-in

Production data lives in the Supabase Postgres behind https://track2.bigseabridge.com, in Account
`acc_demo` (the migrated Harvest history: ~388k time entries, ~7.8k invoices). The id is a leftover
from the demo seed, which is why the seed is now guarded (below).

## 1. Secrets and settings to configure

| Where | Name | Value / purpose |
|---|---|---|
| GitHub → Settings → Secrets and variables → Actions | `BACKUP_DATABASE_URL` | Supabase **session pooler** URL (`…pooler.supabase.com:5432/postgres?sslmode=require`) or the direct URL. Not the transaction pooler (:6543): pg_dump needs a session. Prefer a read-only role (see below). |
| same | `BACKUP_PASSPHRASE` | Long random passphrase (`openssl rand -base64 32`). When set, every dump is gpg-encrypted (AES256) before upload. **Set it**: workflow artifacts are readable by anyone with read access to the repo. Store a copy in the password manager; without it the backups cannot be decrypted. |
| Vercel → Project → Environment Variables (Production) | `MIGRATION_LOCKED` | `1` once Track2 is the system of record. Kill switch: Settings → Migrate refuses backups, imports and credential changes (a dry-run preview still works); `runImportBatch` and the migration scripts refuse to write. Redeploy after changing it. |
| Supabase | Pro plan backups / PITR | GitHub backups are the off-site copy, not a replacement for Supabase's own backups. |

Read-only backup role (run once in the Supabase SQL editor; then use it in `BACKUP_DATABASE_URL`):
```sql
CREATE ROLE track2_backup LOGIN PASSWORD '<generate one>';
GRANT CONNECT ON DATABASE postgres TO track2_backup;
GRANT USAGE ON SCHEMA public TO track2_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO track2_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO track2_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO track2_backup;
```
With the pooler the user name is `track2_backup.<project-ref>`.

## 2. CI and nightly backup (GitHub Actions)

**Parked (2026-10-13):** the three workflows live in `ops/workflows/` (`ci.yml`, `db-backup.yml`,
`keep-warm.yml`) and do not run. To turn them on, move them back:
`git mv ops/workflows/*.yml .github/workflows/` (add the secrets below first, or the backup job fails nightly).
Until then there is no off-site nightly backup, so Supabase Pro + PITR is the only backup.

- `ci.yml`: on every PR and push to `main`: `npm ci`, `prisma generate`, `tsc --noEmit`,
  `npm test` with `TZ=America/New_York` (catches UTC-midnight date bugs), `npm run build` with dummy env.
- `db-backup.yml`: nightly at 07:17 UTC and on demand (Actions → DB backup → Run
  workflow). `pg_dump` 16, custom format, `--schema=public --no-owner --no-privileges`; checks that the
  core tables are in the archive; writes a `.sha256`; encrypts with gpg if `BACKUP_PASSPHRASE` is set;
  uploads artifact `track2-db-<UTC stamp>` kept for **30 days**.
- After adding the secrets, run the workflow once by hand and confirm it is green and the artifact is there.
  GitHub emails a failed scheduled run to whoever last edited the workflow schedule; watch for it.

## 3. Restore from a nightly backup

Restore into a **new, empty** database (a local Postgres 16, or a fresh Supabase project), never over production.

```bash
# 1. Download the artifact (Actions → DB backup → run → Artifacts), or with gh:
gh run download <run-id> -n track2-db-<stamp> -D restore/
cd restore

# 2. Verify and decrypt (skip decrypt if the artifact is a plain .dump)
gpg --batch --pinentry-mode loopback --passphrase-fd 0 --decrypt \
    --output track2-<stamp>.dump track2-<stamp>.dump.gpg <<< "$BACKUP_PASSPHRASE"
sha256sum -c track2-<stamp>.dump.sha256

# 3. Target database: btree_gist must exist before the rate exclusion constraints are restored
export TARGET=postgresql://postgres@localhost:5432/track2_restore   # NEVER the production URL
createdb track2_restore            # or create the Supabase project / database
psql "$TARGET" -c 'CREATE EXTENSION IF NOT EXISTS btree_gist'

# 4. Restore everything except the dump's "CREATE SCHEMA public" (the target already has it)
pg_restore --list track2-<stamp>.dump | grep -v ' SCHEMA - public ' > restore.list
pg_restore --dbname="$TARGET" --no-owner --no-privileges --exit-on-error --jobs=4 \
    --use-list=restore.list track2-<stamp>.dump

# 5. Check it
DATABASE_URL="$TARGET" node scripts/check-db-health.mjs
psql "$TARGET" -c 'SELECT count(*) FROM "TimeEntry"' -c 'SELECT count(*) FROM "Invoice"'
```
To make a restored database the live one, point Vercel's `DATABASE_URL` (transaction pooler) at it and
redeploy; `_prisma_migrations` is part of the dump, so `prisma migrate deploy` continues from where it was.

## 4. Restore drill (done 2026-10-13, Postgres 16.15)

The procedure above was proven end to end on a throwaway local cluster. Commands, exactly as run
(as root on the dev box; the cluster lives on port 5442 and is deleted at the end):

```bash
B=/usr/lib/postgresql/16/bin; D=/var/lib/postgresql/safetyagent
mkdir -p $D && chown postgres:postgres $D
runuser -u postgres -- $B/initdb -D $D/data -U postgres --auth=trust -E UTF8 --locale=C.UTF-8
runuser -u postgres -- $B/pg_ctl -D $D/data -o "-p 5442 -k /tmp -c listen_addresses=localhost" -l $D/log.txt -w start
psql -h localhost -p 5442 -U postgres -c 'CREATE DATABASE track2_drill'
export DATABASE_URL=postgresql://postgres@localhost:5442/track2_drill

npx prisma migrate deploy                      # 14 migrations applied
npx prisma db seed                             # REFUSED: ALLOW_SEED=1 is not set
ALLOW_SEED=1 npx prisma db seed                # Seed complete
node scripts/check-db-health.mjs               # exit 0 (warnings: demo users, acc_globex, stale demo timer)

# make it production-shaped: 1,500 more entries, the '999' > '7801' invoice-number trap, a dropped index
psql "$DATABASE_URL" -f drill-bulk.sql         # INSERT … FROM generate_series(1,1500); DROP INDEX one_running_timer_per_user
node scripts/check-db-health.mjs               # exit 1: MISSING INDEX one_running_timer_per_user; invoice seq 1001 BEHIND numeric max 7801
ALLOW_SEED=1 npx tsx prisma/seed.ts            # REFUSED: acc_demo has 1,507 time entries (demo limit 1000)
node scripts/clear-demo-data.mjs               # REFUSED: ACCOUNT_ID is required
ACCOUNT_ID=acc_demo node scripts/clear-demo-data.mjs              # REFUSED: does not look like demo data
ACCOUNT_ID=acc_demo node scripts/fix-number-sequences.mjs         # dry run: 1001 → 7801
ACCOUNT_ID=acc_demo node scripts/fix-number-sequences.mjs --confirm
ACCOUNT_ID=acc_demo node scripts/rebuild-timesheets.mjs --apply   # REFUSED: go-live check (Track2-native/linked entries)
MIGRATION_LOCKED=1 ACCOUNT_ID=acc_demo node scripts/rebuild-timesheets.mjs --apply   # REFUSED: MIGRATION_LOCKED=1

# backup → encrypt → decrypt → restore → compare (same pg_dump flags as the workflow)
$B/pg_dump "$DATABASE_URL" --format=custom --compress=9 --no-owner --no-privileges --schema=public --file=track2.dump
gpg --batch --pinentry-mode loopback --passphrase-fd 0 --symmetric --cipher-algo AES256 -o track2.dump.gpg track2.dump <<< "$PASS"
gpg --batch --pinentry-mode loopback --passphrase-fd 0 --decrypt -o track2.dec track2.dump.gpg <<< "$PASS" && cmp track2.dump track2.dec
psql -h localhost -p 5442 -U postgres -c 'CREATE DATABASE track2_restore'
psql postgresql://postgres@localhost:5442/track2_restore -c 'CREATE EXTENSION IF NOT EXISTS btree_gist'
$B/pg_restore --list track2.dec | grep -v ' SCHEMA - public ' > restore.list
$B/pg_restore --dbname=postgresql://postgres@localhost:5442/track2_restore --no-owner --no-privileges \
    --exit-on-error --jobs=4 --use-list=restore.list track2.dec
# row counts of 13 tables (Account … TimeEntry=1511, _prisma_migrations=14) identical in both DBs,
# md5 over every TimeEntry (id, minutes, notes, updatedAt) identical
DATABASE_URL=postgresql://postgres@localhost:5442/track2_restore node scripts/check-db-health.mjs
#   faithfully reports the same missing index; after CREATE UNIQUE INDEX … one_running_timer_per_user: exit 0

# cleanup
runuser -u postgres -- $B/pg_ctl -D $D/data -m fast stop && rm -rf $D
```
Learned in the drill: a `--schema=public` dump contains `CREATE SCHEMA public`, so restore with the
`--use-list` filter above; and `btree_gist` must be created in the target first.

The importer protections were exercised in the same drill against a synthetic Harvest delta: an entry
edited in Track2 and one on a Track2 invoice were kept, an untouched one was updated, a new one was
created, an invoice with Track2 activity kept its line items, and the invoice sequence moved to the
numeric max (10234, not the alphabetical '999'). With `MIGRATION_LOCKED=1` the apply was refused.

## 5. Health check (run against production)

```bash
node --env-file=.env scripts/check-db-health.mjs     # .env DATABASE_URL = Supabase session pooler
```
Read-only. Reports: indexes/constraints from `prisma/migrations` + `prisma/sql/constraints.sql` that are
missing (production was set up with `db push` + `migrate resolve`, so the raw-SQL ones may never have been
created), `_prisma_migrations` state, invoice/estimate sequence vs numeric max, demo users and extra
accounts, running timers older than 12 h. Exit code 1 means a PROBLEM line needs fixing.

Fixes for what it may find:
- Missing `one_running_timer_per_user`: `CREATE UNIQUE INDEX IF NOT EXISTS one_running_timer_per_user ON "TimeEntry" ("userId") WHERE "isRunning";`
  (fails if a user already has two running timers: stop the extra one first).
- Missing `person_*_rate_no_overlap`: `CREATE EXTENSION IF NOT EXISTS btree_gist;` then the two
  `ALTER TABLE … ADD CONSTRAINT` statements from `prisma/sql/constraints.sql` (they fail if overlapping rates exist; fix those rows first).
- Sequence behind: `ACCOUNT_ID=acc_demo node --env-file=.env scripts/fix-number-sequences.mjs` (dry run), then `--confirm`.
  It prints the top numbers first: Harvest ids such as 387523 would push the next invoice number past them.
- Demo users (`@bigsea.demo`, password `password123`) on production: delete or deactivate them.

## 6. Data-safety guards (what refuses, and how to get past it deliberately)

| Tool | Guard |
|---|---|
| `prisma/seed.ts` (`db:seed`, `prisma migrate reset`) | Needs `ALLOW_SEED=1` **and** `acc_demo`/`acc_globex` must look like demo data (≤1,000 time entries, ≤100 invoices, ≤50 people, no Harvest id-maps or snapshots). No override. |
| `scripts/clear-demo-data.mjs` | `ACCOUNT_ID` required; dry run unless `--confirm`; refuses any account with id-maps, snapshots or >1,000 time entries. No override. |
| `scripts/rebuild-timesheets.mjs` | `ACCOUNT_ID` required; `--apply` refused under `MIGRATION_LOCKED=1`, or when Track2 holds invoiced/approved/running/native/edited entries unless `--force-after-go-live` (keyed Track2-owned rows are then kept). Writes `updatedAt` = Harvest's `updated_at`. |
| `scripts/migrate-timesheets.mjs` | Superseded. `--apply` refused when any entry is keyed/Track2-owned, or the account has >1,000 entries (unless `ALLOW_BULK_REIMPORT=1` to finish a first import into a fresh account). |
| `scripts/sync-assignments.mjs` | Dry run unless `--apply` (it overwrites assignment rates and PM flags); refused under `MIGRATION_LOCKED=1`. |
| `scripts/migrate-staged.ts` | `--apply` needs `ACCOUNT_ID`; refused under `MIGRATION_LOCKED=1`. |
| `scripts/fix-number-sequences.mjs` | `ACCOUNT_ID` required; dry run unless `--confirm`; only ever raises a sequence. |
| Importer (Settings → Migrate, `runImportBatch`) | Refuses to apply under `MIGRATION_LOCKED=1`. Never overwrites time entries that are locked, invoiced, approved, running or edited in Track2; never rewrites expenses on an invoice; never touches invoices Track2 has sent, paid, edited, linked or copied to Xero (line items included). Skips are listed as "Protected N …" notes. |
| `scripts/backup-harvest-offline.mjs`, `scripts/inspect-db.mjs`, `scripts/check-db-health.mjs` | Read-only towards Track2 domain data (the backup only adds snapshot rows). |
| `scripts/seed-business-entities.mjs` | Only fills NULL entity references; idempotent; not destructive. |

## 7. Exports

- Report screens (Time, Detailed time, Profitability, project Tasks) have an Export ▾ menu: CSV, and
  Google Drive when configured (§8).
- Reports → Export CSV (`/reports/export`) and the detailed time CSV (`/reports/detailed/export`) now
  stream in keyset-paginated batches of 2,000 rows; same columns and permission checks as before.
- Settings → **Data export** (`/settings/export`, admins with `edit_account_settings`): one streamed CSV
  per table (time entries, invoices, invoice line items, payments, clients, contacts, projects, people,
  expenses), every column except password hashes and tokens, scoped to the signed-in account.

## 8. Google sign-in

"Sign in with Google" appears on `/login` only when `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are both
set; without them the app works exactly as before (password only). Password login stays as a fallback.

**How it decides** (`auth.ts` + `modules/shared/googleSignIn.ts`):
- Scopes are sign-in only: `openid email profile`. No Drive access is requested.
- The Google ID token must have `email_verified: true` and an `hd` (Workspace) claim, and both `hd`
  and the email's domain must be in `AUTH_GOOGLE_ALLOWED_DOMAINS`. Personal Gmail accounts have no
  `hd` and are refused. The `hd` authorization parameter is only a hint for Google's account chooser;
  the claim check is what enforces it.
- The email (case-insensitive) must match exactly one **existing, active** Track2 user. Unknown emails
  are refused (`/login?error=GoogleNoUser`), never auto-created; inactive users are refused
  (`GoogleInactive`); an email present in more than one account is refused (`GoogleAmbiguous`).
- The session JWT carries the same claims as a password login, and `lib/session.ts` still re-checks
  `isActive`, account and profile on every request, so deactivating someone cuts off Google sessions too.
- No Auth.js database adapter is used, so there is no OAuth-account linking table. That is why
  `allowDangerousEmailAccountLinking` doesn't apply: there is nothing to link. The mapping is
  "verified Workspace email → active User row", re-decided on every Google sign-in.
- Successful logins aren't written to the audit log (same as password logins; only password failures
  are, for the lockout).
- `/api/auth/*` (including `/api/auth/callback/google`) is outside the middleware matcher, so the
  callback is never redirected to `/login`.

**Setup (once):**
1. Google Cloud console, signed in as a bigsea.co Workspace admin, in a project **under the bigsea.co
   organization**: APIs & Services → OAuth consent screen → User type **Internal** (only accounts in
   the org can use it; no Google verification review needed). App name "Track2", support email,
   scopes `openid`, `email`, `profile` only.
2. APIs & Services → Credentials → Create credentials → OAuth client ID → **Web application**.
   Authorized redirect URIs:
   - `https://track2.bigseabridge.com/api/auth/callback/google`
   - optional: `http://localhost:3000/api/auth/callback/google` for local dev. Vercel preview URLs
     change per deploy and Google doesn't take wildcards, so add a specific preview URL only if needed.
3. Vercel → Project → Environment Variables (Production; Preview/Development if wanted):

| Name | Value |
|---|---|
| `AUTH_GOOGLE_ID` | OAuth client ID (`…apps.googleusercontent.com`) |
| `AUTH_GOOGLE_SECRET` | OAuth client secret |
| `AUTH_GOOGLE_ALLOWED_DOMAINS` | Optional comma list; default `bigsea.co`. With an Internal consent screen only domains in the same Google org can sign in at all. |

4. Redeploy. Check: a bigsea.co account with a Track2 user gets in; a personal Gmail and a bigsea.co
   address with no Track2 user are refused with a message on `/login`.

To turn Google off again, remove `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` and redeploy. Disabling password
login (Google-only) is a later change.

### Export to Google Drive (BugHerd #4/#10)

Time report, Detailed time report, Profitability and a project's Tasks tab have an **Export ▾** menu:
**CSV** (download, as before) and **Google Drive**. Google Drive creates a **new** native Google Sheet in
the exporting user's own My Drive, named like `Track2 – Time report – Clients – 01 Oct–31 Oct 2026`, and
the page comes back with "Saved to your Google Drive · Open spreadsheet". The Drive item only shows when
`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` and `INTEGRATION_ENC_KEY` are all set; otherwise the menu is CSV only.

**How it works** (`modules/integrations/googleDrive.ts`, `lib/googleDrive.ts`, `app/api/google/drive/*`):
- Sign-in scopes are unchanged (`openid email profile`). The first Drive export asks, via our own small
  OAuth flow with incremental consent, for `https://www.googleapis.com/auth/drive.file` (only files the
  app creates; it can't read anything else in Drive) plus `openid email` to confirm whose account it is.
  Parameters: `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, `login_hint` = the
  user's email, `hd` = the allowed domain.
- The OAuth `state` is HMAC-SHA256-signed with `AUTH_SECRET`, holds userId/account, the return page and
  the pending export, expires after 10 minutes, and is bound to the browser by an httpOnly nonce cookie.
  The callback also requires a verified Google email equal to the signed-in Track2 user's email.
- The refresh token is stored per user in `GoogleDriveGrant` (AES-256-GCM via `lib/crypto.ts`), never
  sent to the browser or logged. Each export mints a short-lived access token from it. If Google answers
  `invalid_grant` (revoked/expired), the grant is deleted and the user goes through consent again, then
  the export runs. A user can only use their own grant.
- The CSV is produced by the same generators as the download (`modules/reports/exports.ts`), with the same
  permission checks and account scoping, then uploaded with the Drive v3 upload API (multipart up to 5 MB,
  a single-request resumable upload above that) as `application/vnd.google-apps.spreadsheet`, so Drive
  converts it. Exports over 9M cells or 80 MB are refused with "narrow the timeframe or export CSV".
- The menu shows "Google Drive: connected · Disconnect" once connected; Disconnect deletes the grant and
  revokes it at Google. Users can also remove Track2 at https://myaccount.google.com/permissions.

**Setup (once, after the sign-in setup above):**
1. Same Google Cloud project → APIs & Services → Library → enable **Google Drive API**.
2. OAuth consent screen (Internal) → Data access / Scopes → add `https://www.googleapis.com/auth/drive.file`
   (a non-sensitive scope; no verification needed for an Internal app).
3. Credentials → the same OAuth client → Authorized redirect URIs → add
   `https://track2.bigseabridge.com/api/google/drive/callback` (and `http://localhost:3000/api/google/drive/callback`
   for local dev). The redirect URI is built from `APP_URL`/`AUTH_URL` (`lib/appUrl.ts`), so it is the
   production host even on preview deploys; test Drive export on production or localhost.
4. Vercel env: `INTEGRATION_ENC_KEY` (already set) and `AUTH_SECRET` must be present; no new variables.
5. Apply migration `20261014090000_google_drive_grant` (one new table, idempotent; `prisma migrate deploy`
   or paste it into the Supabase SQL editor) **before** deploying the code.
6. Check: Reports → Export ▾ → Google Drive → consent screen (first time) → back on the report with
   "Saved to your Google Drive · Open spreadsheet"; a second export goes straight through.

Rotating `INTEGRATION_ENC_KEY` makes stored grants undecryptable; they are dropped on next use and users
are simply asked to consent again.

**Next: Google Drive export** (BugHerd #4/#10, not built). Plan: keep sign-in scopes as they are and ask
for `https://www.googleapis.com/auth/drive.file` only when someone first clicks "Export to Google Drive"
(incremental consent: `include_granted_scopes=true`, `access_type=offline`, `prompt=consent` the first
time). `drive.file` only reaches files the app creates. Store the refresh token per user, encrypted with
`lib/crypto.ts` (`INTEGRATION_ENC_KEY`), in a small new table (e.g. `UserGoogleCredential`: userId,
accountId, encrypted refresh token, granted scopes, timestamps), revocable by the user. Exports then mint
short-lived access tokens server-side and upload the file.

## 9. MCP server and personal access tokens (specs/22)
- **Endpoint:** `POST https://track2.bigseabridge.com/api/mcp` (Streamable HTTP, stateless JSON-RPC; `GET` → 405).
  Not behind the login middleware (the matcher skips `/api/*`); auth is `Authorization: Bearer track2_pat_…`.
- **Deploy:** run `prisma migrate deploy` so `20261014120000_api_tokens` creates `ApiToken` (idempotent, additive).
  No new env vars.
- **Tokens:** each person creates/revokes their own at **/settings/tokens** (sidebar → your name → *API tokens*).
  Only the SHA-256 is stored; a token acts as its owner and every request re-reads `isActive`, profile and
  overrides, so deactivating a person or revoking the token cuts access on the next call.
- **Emergency revoke-all:** `UPDATE "ApiToken" SET "revokedAt" = now() WHERE "revokedAt" IS NULL;`
  (one person: add `AND "userId" = '<id>'`).
- **Audit:** every write tool call writes an `AuditLog` row with `entityType = 'api_token'`, `entityId` = token id,
  actor = the user, `after.tool` / `after.args`. Domain rows (time entries, invoices) are written as usual.
- **Limits:** 120 requests/minute per token per server instance (429 + `Retry-After`). A DB that is waking up
  answers 503 + `Retry-After: 5`.
- **Smoke test:** `curl -s -X POST …/api/mcp -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`

### 9a. claude.ai connector (OAuth 2.1)
- **Deploy:** `prisma migrate deploy` applies `20261014180000_mcp_oauth` (4 new tables, idempotent). No new env
  vars, but **`APP_URL` must be `https://track2.bigseabridge.com`**: it is the OAuth issuer, the token audience
  (`<APP_URL>/api/mcp`) and the only Origin the consent form accepts. Consent from a preview domain is refused (403).
- **Add it (each person):** claude.ai › **Settings › Connectors › Add custom connector** → name `Track2`, URL
  `https://track2.bigseabridge.com/api/mcp`, leave the advanced OAuth fields empty → **Add**, then **Connect**.
  A Track2 window opens: sign in if needed, review "Claude wants to access Track2 as {you}…", click **Allow**.
  (Team/Enterprise: an Owner adds the connector once under organization settings; each person still clicks Connect.)
- **What it can do:** exactly what that person can do in Track2 (same permissions as a PAT). Access tokens last 1 hour;
  claude.ai refreshes them (refresh tokens rotate, 30 days idle limit). Re-connecting creates a new grant.
- **Revoke (one person):** Track2 › your name › *API tokens* › **Connected apps** › Revoke. Deactivating the person also
  cuts access on the next call.
- **Emergency revoke-all OAuth:** `UPDATE "OAuthGrant" SET "revokedAt" = now() WHERE "revokedAt" IS NULL;
  UPDATE "OAuthToken" SET "revokedAt" = now() WHERE "revokedAt" IS NULL;`
- **Discovery check:** `curl -s https://track2.bigseabridge.com/.well-known/oauth-protected-resource` and
  `…/.well-known/oauth-authorization-server`; `curl -si -X POST …/api/mcp` must show
  `www-authenticate: Bearer realm="Track2", resource_metadata="…/.well-known/oauth-protected-resource"`.
- **Audit:** consent → `entityType = 'oauth_client'`; tool writes and disconnects → `'oauth_grant'` (entityId = grant id).
- **Housekeeping (optional, monthly):** `DELETE FROM "OAuthAuthorizationCode" WHERE "createdAt" < now() - interval '1 day';`
  and `DELETE FROM "OAuthClient" c WHERE "createdAt" < now() - interval '7 days' AND NOT EXISTS (SELECT 1 FROM "OAuthGrant" g WHERE g."clientId" = c.id);`
