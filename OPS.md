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

## 9b. Row Level Security on the PR #7 tables (applied 2026-10-14)
The PR #7 migrations were applied in the Supabase SQL editor with **Run and enable RLS**, so these tables
have RLS on with no policies: `ApiToken`, `GoogleDriveGrant`, `ManagerAssignment`, `TeamPin`,
`OAuthClient`, `OAuthAuthorizationCode`, `OAuthGrant`, `OAuthToken`. Track2 connects as the table owner
(`postgres`), which bypasses RLS, so the app is unaffected; Supabase's public API (anon/authenticated
keys) can't read them. If token creation or the claude.ai connector ever fails with a permission error,
undo with `ALTER TABLE "<name>" DISABLE ROW LEVEL SECURITY;` for each table above. A read-only backup
role needs `BYPASSRLS` (or use `postgres`) to dump these tables.

## 10. Billing chain: trace, checks, tests

The chain is: send invoice → email (SendGrid) → client opens → Stripe payment → payment recorded → Xero.
Every step writes one `InvoiceEvent` row (`modules/observability/invoiceTrace.ts`, `recordInvoiceEvent`):
stage, source (`app`, `email`, `client`, `stripe`, `xero`, `cron`), level (`info`/`warn`/`error`), message,
provider ids, HTTP status, duration and a redacted `detail` JSON. A failed trace write never blocks the
business action; provider webhook retries are de-duplicated on `(source, externalEventId)`.

### Trace stages

| Stage | Source | Written when |
|---|---|---|
| `invoice.sent` | app | Invoice sent (or re-sent / reminder) from Track2 |
| `email.accepted` | email | SendGrid accepted the message (202); `externalId` = SendGrid message id |
| `email.delivered` | email | SendGrid event webhook: the recipient's server accepted it |
| `email.bounced` / `email.dropped` | email | Hard bounce, or SendGrid refused to send (suppression list, invalid address). Level error |
| `email.spam_report` | email | The recipient marked it as spam. Level error |
| `email.opened` | email | Open pixel fired (unreliable: Apple Mail prefetches, many clients block images) |
| `invoice.viewed` | client | The client opened the public invoice link `/i/<token>` |
| `payment.checkout_started` | client / stripe | Client clicked Pay; a Stripe Checkout Session was created |
| `payment.webhook_received` | stripe | A Stripe webhook arrived and its signature verified |
| `payment.recorded` / `payment.failed` | stripe | Payment written to Track2 / payment failed at Stripe |
| `payment.refunded` / `payment.disputed` | stripe | Refund or dispute on a paid invoice |
| `xero.invoice_synced` / `xero.payment_synced` | xero | Invoice / payment copied to Xero; `externalId` = Xero id |
| `xero.error` | xero | Xero rejected a copy (validation, expired token, rate limit). Level error |
| `health.<provider>` | cron / app | One row per health check result (see below); `externalId` = check key |
| `health.alert` | cron | An alert email went to the admins for a failing check (dedupe marker) |

The email, Stripe and Xero stages are written by their own modules; the exact list may grow.
Unknown stages still show up in the trail and the log, they just don't feed the summary chips.

### Reading the trail

Invoice page → **Delivery & payment trail** (needs `manage_invoices`). Chips at the top summarise:
**Email** (Delivered / Bounced / Spam report / Not yet delivered / Send failed), **Opened by client**
(first open), **Paid via Stripe** (Paid / Failed / Checkout started / Refunded / Disputed), **Xero**
(Synced / Error / Not synced); the latest relevant event wins (`modules/observability/invoiceTraceSummary.ts`).
Below, events are newest first in the account timezone: grey = info, amber = warn, red = error. Click an
external id to copy it; *Details* shows the redacted payload. Invoices sent before tracing existed have
no trail.

**Settings → Activity log** (`/settings/activity-log`, `edit_account_settings` or `manage_invoices`):
every event for the account. Opens on **Problems** (warn + error, last 30 days); **All events** plus
filters for level, source, stage prefix (`email.`, `payment.`, `xero.`, `health.`), date range (account
timezone) and invoice number. 50 per page (keyset on `occurredAt, id`), level counts aggregated in the DB,
each row links to its invoice, **Export CSV** downloads the filtered rows (up to 20,000).

### Health checks

`modules/observability/healthChecks.ts` (pure, fetch injected) + `healthRunner.ts` (loads credentials,
records results, alerts). Read-only GETs, 10 s timeout each, per connection (per business entity):

| Check | Calls | Error when |
|---|---|---|
| `sendgrid.api_key` | `GET /v3/scopes` | 401/403, or no `mail.send` scope |
| `sendgrid.event_webhook` | `GET /v3/user/webhooks/event/settings` | disabled, or URL isn't `APP_URL/api/email/events` (warn: delivered/bounce/dropped/spam_report or open not ticked) |
| `sendgrid.domain` | `GET /v3/whitelabel/domains` | a from-domain in use (connection default + entity senders) isn't authenticated/valid |
| `stripe.account` | `GET /v1/account` | key rejected, `charges_enabled` false (warn: test key on production) |
| `stripe.webhook` | `GET /v1/webhook_endpoints` | no enabled endpoint at `APP_URL/api/integrations/stripe/webhook/<accountId>` or `APP_URL/api/stripe/…`, or `checkout.session.completed` missing (warn: other required events missing) |
| `xero.connection` | `GET https://api.xero.com/connections` | token rejected (expired → reconnect), or the configured tenant isn't connected |
| `xero.organisation` | `GET /api.xro/2.0/Organisation` | 401/403/no organisation/not ACTIVE |
| `internal.errors_24h` | DB | ≥10 error events in 24h (warn at ≥1) |
| `internal.undelivered` | DB | an `email.accepted` >72h old (warn >24h, last 14 days) with no delivered/bounced/dropped since |
| `internal.xero_payments` | DB | a `payment.recorded` >1h old (last 14 days) with no `xero.payment_synced` and no `Payment.xeroPaymentId`, when a Xero connection copies payments |

A key that may send mail but not read settings gets a 403 on the webhook/domain checks: either grant
it read access to Mail Settings and Sender Authentication, or treat those two as "verify by hand".
The Xero check does not refresh tokens (a refresh rotates the stored refresh token, so it is not
read-only); an expired access token shows as an error with a reconnect hint.

**When they run:** daily inside the existing `/api/cron/timers` job (09:00 UTC; its JSON has a `health`
field), on demand at `GET /api/cron/integrations-health` with `Authorization: Bearer $CRON_SECRET`
(200 if no errors, 503 otherwise, so an uptime monitor can poll it), and from **Run checks now** on the
Activity log page (admins; results inline, no email). No new `vercel.json` entry (Hobby cron limits).

**Alerts:** an `error` result emails every active administrator via the SendGrid connection, at most once
per 24h per check and connection (dedupe on the latest `health.alert` event with the same check key).
If SendGrid itself is broken the alert can't be emailed; the `health.alert` row says so (level warn), and
the cron route's 503 is the backstop.

### Investigating a failure: where is the problem?

1. Open the invoice's trail (or filter the Activity log by invoice number) and find the **last green step**.
2. **Our end** (stage missing entirely, or an `app`-source error): no `invoice.sent` → the send action failed
   before email (check Vercel function logs for the request); `email.accepted` missing after `invoice.sent`
   → our call to SendGrid failed (the error event has the HTTP status). A Stripe payment visible in Stripe
   but no `payment.webhook_received` → the webhook never reached us: run the checks (`stripe.webhook`),
   then Stripe Dashboard → Developers → Webhooks → the endpoint's delivery attempts.
3. **Email provider**: `email.accepted` but no outcome after 24h → SendGrid Activity feed for the message id
   (copy it from the trail); `sendgrid.event_webhook` check. `email.bounced`/`dropped` → the detail has the
   reason (bad address, suppression list); fix the client contact, remove the suppression in SendGrid,
   resend. `email.spam_report` → contact the client another way; check domain authentication.
4. **Payment processor**: `payment.failed` detail has Stripe's decline / failure code; the `externalId` is the
   PaymentIntent or Checkout Session, searchable in the Stripe Dashboard. Refunds/disputes are handled in Stripe.
5. **Xero**: `xero.error` detail has Xero's validation message (unknown account code, contact archived,
   period locked, token expired). Fix in Xero or Settings → Integrations, then use **Copy to Xero** on the
   invoice. `internal.xero_payments` lists payments that never made it.

### Tests

```bash
npm run test:billing   # invoicing, payments, Stripe, Xero, email, observability, money, appUrl unit tests (DB-free)
npm test               # everything; includes all of the above
npm run test:chain     # end-to-end chain on a disposable DB (needs DATABASE_URL; never production)
```
`test:chain` (`test/billing-chain.integration.test.ts` + `test/email-trace.integration.test.ts`) runs the
real code paths against Postgres with SendGrid, Stripe and Xero faked at `fetch`: send → SendGrid accepts →
signed delivered/open events through `/api/email/events` → the client opens `/i/<token>` → a signed
`checkout.session.completed` through the Stripe webhook route → payment recorded, receipt emailed, payment
copied to Xero. It then replays every provider retry (same SendGrid batch, same Stripe event, sibling
`payment_intent.succeeded`) and asserts nothing doubles: one payment, one receipt, one Xero invoice and
payment, no duplicate trail rows. It also checks that forged SendGrid/Stripe posts are refused and write
nothing, that a Xero outage leaves the payment recorded with an error on the trail and `syncPendingXero`
finishes it exactly once, and that no secret ends up in the trail. It creates its own rows in `acc_globex`
(refusing to run if that account already has SendGrid/Stripe/Xero connections) and deletes them after.

`test:billing` is a vitest file filter (`invoic payment stripe xero email observability money appUrl`),
so new test files in those areas are picked up automatically. Run it before any change to the billing
chain. `ops/workflows/ci.yml` already runs `npm test` (which includes these) on every PR and push to
`main`, but CI is parked (§2); re-enabling it is Dzuy's call.

## 11. Stripe payments

Clients pay from the public invoice link (`/i/<token>` → **Pay $X** → Stripe-hosted Checkout). Stripe
tells Track2 by webhook; Track2 records the payment once, emails a receipt and copies it to Xero.
Code: `app/i/[token]/actions.ts` (checkout), `modules/integrations/stripeWebhookHandler.ts` (webhook
decisions), `modules/integrations/stripeWebhook.ts` (signature + event mapping). Spec: specs/14 §2.

### Configure (once per company with its own Stripe account)
1. **Webhook endpoint** (Stripe Dashboard → Developers → Webhooks → Add endpoint), live mode:
   `https://track2.bigseabridge.com/api/integrations/stripe/webhook/acc_demo`
   (the exact URL is shown under Settings → Integrations → Stripe for each company).
2. **Events to send** (select exactly these):
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `payment_intent.payment_failed`
   - `charge.refunded`
   - `charge.dispute.created`

   `payment_intent.succeeded` and `charge.succeeded` are also understood (same payment, de-duplicated by
   PaymentIntent id) but add nothing; leave them off. Leave `charge.failed` off (it repeats
   `payment_intent.payment_failed`).
3. Copy the endpoint's **signing secret** (`whsec_…`) and the account's **secret key** (`sk_live_…`, or a
   restricted key with Checkout Sessions write) into Settings → Integrations → *company* → Stripe, tick
   Credit card / ACH, Connect. One endpoint URL serves every company: the secret that verifies the
   signature tells Track2 which Stripe account sent the event.
4. `APP_URL` must be `https://track2.bigseabridge.com` in Vercel: Stripe's success/cancel links are built
   from it (never from request headers).

### Test-mode check (before going live, or after any change)
Use a test secret key + a test endpoint secret on a non-production deployment (a preview, or local
`next start`), never on production data.
```bash
stripe login
# forward test events to Track2; prints a whsec_… — paste it as the company's webhook signing secret
stripe listen --forward-to https://<preview-or-localhost:3000>/api/integrations/stripe/webhook/<accountId> \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,payment_intent.payment_failed,charge.refunded,charge.dispute.created
stripe trigger checkout.session.completed   # no invoice metadata → 200, traced as webhook_received, nothing recorded
```
Then the real path: open a sent invoice's client link, **Pay**, card `4242 4242 4242 4242` (any future
date/CVC) → back on the invoice you see **Payment received — thank you**, and within seconds the invoice is
paid with one Stripe payment. ACH: pick *US bank account*, test bank "Success" → **Payment processing**;
`stripe listen` shows `checkout.session.completed` (unpaid) now and `async_payment_succeeded` a few
minutes later, when the invoice becomes paid. Card `4000 0000 0000 0002` → declined, `payment.failed`
traced, invoice still open. A bad signature: `curl -si -X POST <url> -d '{}'` → `400 Invalid signature`
and a `payment.webhook_rejected` row. In the Stripe Dashboard every delivery to the endpoint should be 2xx.

### What each trace stage means (`InvoiceEvent`, newest first per invoice)
| Stage | Level | Meaning / what to do |
|---|---|---|
| `payment.checkout_started` | info | Client clicked Pay; Checkout Session created (externalId = `cs_…`; amount, currency, methods). A double click replays the same session (one row). |
| `payment.checkout_failed` | error | Stripe refused to create the session (bad key, amount below Stripe's minimum, method not enabled). The client saw "couldn't start the online payment, you have not been charged". Fix the Stripe connection; detail has Stripe's error code. |
| `payment.client_returned` | info | Client came back from Stripe: `paid`, `processing`, `confirming`, `not_completed` or `canceled`. |
| `payment.webhook_received` | info | Every verified Stripe event (externalEventId = `evt_…`, so a Stripe retry is recognised). Detail: event type, ids, amount, currency, livemode, status, the action taken and which company's secret verified it. |
| `payment.webhook_rejected` | warn | Bad / missing / expired signature, no connected Stripe with a signing secret, or non-JSON. Nothing stored from the body. A burst usually means a wrong `whsec_` after rotating the endpoint secret: paste the new one. |
| `payment.processing` | info | ACH payment started; not paid until it settles (3–5 business days). The client page says so and hides Pay. |
| `payment.recorded` | info | Payment row created (paymentId; externalId = `pi_…`). Invoice paid in full or balance reduced. |
| `payment.duplicate_ignored` | info | Another event (or a retry, or a concurrent delivery) for a payment already recorded. Normal: Stripe sends 2–3 events per payment. |
| `payment.flagged` | warn | Money arrived that Track2 did not apply: invoice paid / draft / written off / closed, currency mismatch, invoice not found — or it was applied but **overpaid** the invoice. Also on the invoice's activity log and in the integration sync log. **Do:** check Stripe; either refund the client in Stripe, or record the payment by hand / apply the credit to another invoice. |
| `payment.failed` | warn | The client's payment didn't go through (card declined in Checkout, or an ACH debit that bounced). Invoice stays open. For a bounced ACH (also on the activity log), contact the client. |
| `payment.refunded` | error | A refund was issued in Stripe. **The invoice is not changed automatically.** Do: delete the payment (full refund → the invoice reopens) or delete it and record the net amount (partial refund); tell Xero if it was already copied. |
| `payment.disputed` | error | The client's bank opened a dispute (chargeback). Respond in the Stripe Dashboard before its deadline (evidence: the invoice PDF, timesheets, correspondence). Change the invoice only if the dispute is lost. |
| `payment.record_error` | error | A database error while recording; Track2 answered 500 so Stripe retries (for up to 3 days). A later `payment.recorded` for the same `pi_…` means it healed. If not, check the DB, then resend the event from the Stripe Dashboard (Webhooks → event → Resend). |

Quick look (SQL editor): `SELECT "occurredAt", stage, level, message, "externalId" FROM "InvoiceEvent" WHERE stage LIKE 'payment.%' AND level <> 'info' ORDER BY "occurredAt" DESC LIMIT 50;`

## 12. Email deliverability (invoice, reminder and receipt mail via SendGrid)

Client mail goes out through the account's SendGrid connection (Settings → Integrations → SendGrid; the
API key is stored encrypted there, not in Vercel). From-address: the business entity's sender
(Settings → Companies) → the SendGrid connection's "Default from address" → for name and reply-to only,
the default **Sender address** in Invoices → Configure. Every step lands on the invoice trace
(`InvoiceEvent`): `invoice.sent|resent|reminder_sent` → `email.send_requested` → `email.accepted`
(externalId = SendGrid `X-Message-Id`) or `email.rejected` (HTTP status + provider error) → provider
events from the webhook (`email.processed|delivered|deferred|bounced|dropped|spam_report|unsubscribed|opened|clicked`)
→ `invoice.viewed` when the client opens `/i/<token>` (bots, prefetches, HEAD and our own signed-in
users excluded; at most one row per 30 min).

Double sends: "Send invoice" is guarded by the draft → open claim; "Resend invoice" and "Send reminder"
refuse a second identical email within 60 s unless the first was rejected (per-invoice advisory lock +
trace check, `modules/email/sendGuard.ts`). A SendGrid timeout (15 s) is ambiguous; the trace says so
and Resend stays allowed.

### 12a. To configure (Dzuy)

| Where | What |
|---|---|
| Vercel → Environment Variables (Production) | `APP_URL=https://track2.bigseabridge.com`. Invoice links are built from it; in production a missing/localhost/http APP_URL now **refuses** the send (traced as `email.rejected`) rather than mailing a dead link. |
| same | `SENDGRID_WEBHOOK_PUBLIC_KEY` = the key from the step below (base64, as SendGrid shows it). Without it `/api/email/events` answers 503 and records nothing. Redeploy after setting. |
| SendGrid → Settings → Mail Settings → Event Webhook | Create a webhook: **POST URL** `https://track2.bigseabridge.com/api/email/events`; events: Processed, Delivered, Deferred, Bounced, Dropped, Spam reports, Unsubscribes (+ Group unsubscribes), Opened, Clicked; **Signature verification: ON** → copy the verification key into `SENDGRID_WEBHOOK_PUBLIC_KEY`. Use "Test your integration" afterwards: SendGrid's test events have no `invoiceId`, so the route answers 200 with `ignored: N` (that is success). OAuth on the webhook: leave off. |
| SendGrid → Settings → Tracking | **Click tracking: OFF** (the app also disables it per message, but turn it off globally so receipts/invites never get links rewritten through `sendgrid.net`). **Subscription tracking: OFF** (it adds an unsubscribe footer; invoices are transactional). Open tracking: ON is fine. Google Analytics tracking: OFF. |
| SendGrid → Settings → Sender Authentication | **Authenticate each from-domain** (Domain Authentication, "automated security" ON, custom return path e.g. `em` → SendGrid generates `emXXXX.<domain>` CNAME + `s1._domainkey` / `s2._domainkey` CNAMEs). Domains: **bigsea.co** (Big Sea sender, e.g. `billing@bigsea.co`) and **cordelialabs.com** if Cordelia's company sender uses that domain. Single Sender Verification alone is not enough (no DKIM alignment → DMARC fails at Gmail/Yahoo/Microsoft). Link Branding: not needed while click tracking is off. |
| DNS for each from-domain | Add the 3 CNAMEs SendGrid shows (em… / s1._domainkey / s2._domainkey) and press **Verify**. SPF: with automated security the `em…` CNAME carries SPF for the return path, so the root SPF does **not** need `include:sendgrid.net` (adding it is harmless; keep the root record under 10 DNS lookups and a single `v=spf1` record). DMARC: if `_dmarc.<domain>` is missing, add `v=DMARC1; p=none; rua=mailto:dmarc@<domain>; adkim=r; aspf=r`; after 2–4 weeks of clean reports move to `p=quarantine`. |
| Invoices → Configure → Sender addresses / Settings → Companies | Each company's sender email must be on an authenticated domain; set a monitored reply-to (e.g. `billing@bigsea.co`) so client replies reach a person. |

### 12b. DNS checks (could not run from the agent box: no outbound DNS)

Run from any laptop and paste the answers into this section:
```bash
for d in bigsea.co cordelialabs.com; do
  echo "== $d"; dig +short TXT $d | grep -i spf; dig +short TXT _dmarc.$d
  dig +short CNAME s1._domainkey.$d; dig +short CNAME s2._domainkey.$d
done
dig +short CNAME em<NNNN>.bigsea.co   # the em… host SendGrid listed
```
Expect: one `v=spf1 … ~all|-all` record; a `v=DMARC1` record; `s1/s2._domainkey` → `s1.domainkey.uXXXX.wl.sendgrid.net`
style targets. Then send a test invoice to a Gmail address, "Show original": SPF, DKIM and DMARC must all say
**PASS** with `d=bigsea.co` (not `d=sendgrid.net`).

### 12c. What the code does for deliverability (and why)
- multipart: a plain-text part is always sent with the HTML; no image-only bodies; subject lines are plain
  ("Invoice 1042 from Big Sea"), CR/LF stripped.
- Links: only the APP_URL invoice link (`/i/<token>`); no shorteners; click tracking off per message
  (`tracking_settings.click_tracking.enable=false`) so links aren't rewritten through `sendgrid.net`,
  which mismatches the from-domain and looks like phishing in a payment email.
- No `List-Unsubscribe` header and subscription tracking off: invoices, reminders and receipts are
  transactional; an unsubscribe would let a client opt out of their own invoices and SendGrid would then
  suppress future invoices to them. The Gmail/Yahoo one-click-unsubscribe rule targets bulk mail.
- Recipients: every client contact flagged "invoices" with an email (de-duplicated), else the first contact
  with an email. No PDF attachment (the email links to the online invoice, which has Print/PDF);
  attachments raise spam scores and can't be revoked.
- `custom_args { invoiceId, accountId, traceKind }` + categories `track2`, `invoice-<kind>` on every send.

### 12d. Reading the trace when a client says "I never got it"
`SELECT "occurredAt", stage, level, message, "externalId", "httpStatus" FROM "InvoiceEvent" WHERE "invoiceId" = '<id>' ORDER BY "occurredAt";`
- no `email.accepted` → we never handed it to SendGrid (see `email.rejected` message: not connected, no recipient, 4xx).
- `email.accepted` but no `email.delivered`/`email.bounced` → webhook not configured, or search SendGrid Activity by the message id (`externalId`).
- `email.bounced` / `email.dropped` → fix the contact address (a dropped address is on SendGrid's suppression list:
  SendGrid → Suppressions → remove it, then Resend). `email.spam_report` → call the client; SendGrid suppresses
  them until removed.
- `email.delivered` but no `email.opened`/`invoice.viewed` → it is in their spam/quarantine folder or unread.

## 13. Xero sync

Track2 copies **sent invoices** and **recorded payments** (manual and Stripe) to the Xero organisation of
the invoice's company (Big Sea or Cordelia Labs, specs/16). It is one-way: Track2 → Xero. Code:
`modules/integrations/xeroSyncCore.ts` (rules, unit-tested), `xeroSync.ts` (DB wiring),
`xeroClient.ts` (HTTP, retries), `xeroAuth.ts` (tokens).

### Go-live rule (read before connecting)
Harvest already copied every Harvest invoice and payment to Xero. Track2 must not create them again:
- Only invoices **sent on or after the cutover** are created in Xero. The cutover is the connection's
  **"Copy invoices sent on/after"** date (`syncFromDate`); if it is blank, the date the connection was saved.
  **Set it to the cutover day** (the day Track2 becomes the system of record).
- Invoices and payments imported from Harvest (anything in `MigrationIdMap`) are **never created** in Xero.
  An imported invoice is only *linked* when Xero already has an ACCREC invoice with the same number, for example
  when a client pays an old Harvest invoice in Track2 after cutover: the payment goes onto Harvest's copy.
- Before creating anything, Track2 looks Xero up by **InvoiceNumber**. A match is linked, not duplicated.
  Xero also refuses duplicate invoice numbers.

### Setup (once per company: Big Sea, then Cordelia Labs)
1. **Xero app**: create it at developer.xero.com → *My Apps* → **New app**. Choose one of these:
   - **Web app (standard OAuth 2.0)**: free. Redirect URI `http://localhost:8080/callback` (used only to get
     the first tokens, see step 2). Scopes: `offline_access accounting.transactions accounting.contacts`.
     If the app only offers Xero's newer granular scopes, choose read and write for invoices, payments and
     contacts. Without `offline_access` there is no refresh token, so the sync stops after 30 minutes.
   - **Custom connection**: a paid Xero add-on, one organisation per connection. The token comes from
     the client id and secret alone. Same `accounting.*` scopes. Leave the token fields in Track2 blank.
2. **First tokens (web app only)**: run Xero's `xoauth` CLI (github.com/XeroAPI/xoauth) with the app's
   client id and secret and the scopes above, sign in, and pick the organisation. It prints `access_token`,
   `refresh_token` and the tenant id (or call `GET https://api.xero.com/connections` with the access token:
   `tenantId`). Authorize **each organisation separately**, so each company has its own refresh token.
   Two connections sharing one refresh token would invalidate each other on rotation.
3. **Track2 → Settings → Integrations → (company) → Xero**:
   | Field | Value |
   |---|---|
   | Access token / Refresh token | from step 2 (blank for a custom connection) |
   | OAuth client secret / client ID | from the Xero app (or Vercel env `XERO_CLIENT_SECRET` / `XERO_CLIENT_ID`) |
   | Xero tenant ID | the organisation's `tenantId` |
   | Default revenue account code | e.g. `400.2` (Fee Income). Required: Xero refuses approved invoices without one |
   | Sales tax account code | the liability account for sales tax (e.g. `820`). Blank = revenue account |
   | Payment account code | the account payments land in, e.g. the **Stripe** clearing account. It must be a bank account or have *Enable payments to this account* ticked. Blank = do not copy payments |
   | Copy invoices sent on/after | the cutover date `YYYY-MM-DD` |
   Saving resets the "needs reconnect" flag.
4. **Currencies**: every currency Track2 invoices in must be enabled in Xero (*Settings → Currencies*);
   otherwise Xero rejects the invoice with a validation error.
5. **Tax**: Track2's tax and discount are sent as their own lines with `LineAmountTypes = NoTax`, so
   Xero adds no tax of its own and **Xero's total equals Track2's total to the cent**. Tax appears on the
   *Sales tax account* line, not as a Xero tax rate. If the accountant wants Xero tax rates, that needs a
   TaxType mapping (not built).

### What gets sent
- Contact: the stored `Client.xeroContactId`, otherwise an exact (case-insensitive) name match, then a
  contact email match, and only then a new contact. The stored id is reused only for the client's own company.
- Invoice: `ACCREC`, `Status = AUTHORISED`, InvoiceNumber = the Track2 number, Date = issue date, DueDate
  (falls back to the issue date), CurrencyCode, Reference = `PO …` or `Track2 <number>`, lines on the
  revenue account, and the discount and tax lines. A linked invoice is fetched and compared. It is updated
  only while Xero has no payments or credits on it, and is never created twice.
- Payment: Account = payment account code, Amount, Date = paid-on date, Reference = note + `T2:<paymentId>`.
  The marker lets a retry find a payment whose response was lost. If the invoice is not in Xero yet, it is
  created first. **Overpayment**: Xero takes only the amount still due. The excess is flagged (warn event +
  failed sync-log row) and must be entered in Xero by hand as an overpayment or refund.
- Each write carries an `Idempotency-Key` (record id + body hash). Calls time out after 15 s. A 429 waits for
  `Retry-After` (at most 3 retries, 60 s cap). 5xx errors and timeouts on safe calls are retried with backoff,
  and 4xx errors are never retried. An uncertain invoice create (timeout or 5xx) is followed by an InvoiceNumber
  lookup before it is retried.
- Token: refreshed 2 minutes before expiry or after a 401, under a Postgres advisory lock. The rotated
  refresh token is saved in the same transaction. A Xero refusal (`invalid_grant`, revoked app, tenant no
  longer connected) sets the connection to **Reconnect needed** (status `error`) and stops calling Xero.

### When it runs
- **Invoice sent** and **Resend**: invoice (20 s budget). **Payment recorded**: invoice if missing, then
  payments (20 s). **Stripe webhook**: same, after the payment is recorded (8 s budget, best-effort: the
  webhook still returns 200).
- **Invoice → Actions → Copy to Xero**: the manual retry. It links or updates the invoice and copies every
  payment not yet in Xero, and writes the outcome to the activity log.
- **`syncPendingXero(accountId, { dryRun?, limit = 25, budgetMs? })`** in `modules/integrations/xeroSync.ts`
  is the sweep for a cron or admin button. It covers open and paid invoices with no Xero id, and payments with
  no Xero id, from after the cutover and not from Harvest. It returns a summary of counts and per-item results.
  Run it with `dryRun: true` first. Xero allows 60 calls per minute per organisation, so keep `limit` modest
  and re-run while `hasMore` is true. It stops early on an auth failure or a long rate limit (`stoppedEarly`).

### Trace stages (`InvoiceEvent`, source `xero`)
| Stage | Level | Meaning / action |
|---|---|---|
| `xero.invoice_sync_started` | info | A sync of this invoice began (tenant, pending payments in detail). |
| `xero.invoice_synced` | info (warn if Xero status isn't AUTHORISED/PAID) | Created, linked, updated or unchanged. `externalId` = Xero InvoiceID; detail has `xeroTotalCents` vs `track2TotalCents`. |
| `xero.invoice_total_mismatch` | error | Xero's total or currency differs from Track2's. The Xero id is still stored, so there is no duplicate. `preflight: true` means nothing was sent because the mapped lines didn't add up. **Fix in Xero (or the invoice) by hand.** |
| `xero.payment_synced` | info (warn on overpayment) | `paymentId` set, `externalId` = Xero PaymentID; detail has amount, overpayment and how (created or linked). |
| `xero.token_refreshed` | info | Access token refreshed (or a concurrent refresh reused). |
| `xero.auth_failed` | error | **Reconnect needed**: re-enter tokens in Settings → Integrations, then retry. |
| `xero.rate_limited` | warn | 429, with `retryAfterSec`. With "giving up", the item stays pending for the next retry. |
| `xero.validation_error` | error | Xero's `ValidationErrors` messages (bad account code, currency not enabled, archived contact…). Fix the setting, then retry. |
| `xero.error` | error (warn = uncertain create, looking up) | Other HTTP status, timeout or network error, with the redacted response. |
| `xero.skipped` | info | Not connected, the company has no Xero org, draft, payments off, Harvest or pre-cutover invoice. |
Every failure also writes an `IntegrationSyncLog` row (`provider = 'xero'`, `ok = false`, `entityId` =
invoice, payment or client id). Tokens are never written to either table.

### Retry
1. Fix the cause (the trace message says what): reconnect, account code, currency, contact.
2. On the invoice, use **Actions → Copy to Xero**. For a backlog, run `syncPendingXero(accountId, { dryRun: true })`,
   review it, then run it without `dryRun`.
Retries are safe. A linked invoice is compared and not re-created, and a payment that is already in Xero is
found by its `T2:` marker.

### Reconcile (monthly, or after an incident)
```sql
-- Track2 invoices since cutover that should be in Xero but aren't
SELECT number, "sentAt", "totalCents" FROM "Invoice"
WHERE "accountId" = 'acc_demo' AND status IN ('open','paid') AND "xeroInvoiceId" IS NULL AND "sentAt" >= '<cutover>';
-- Payments since cutover not in Xero
SELECT p.id, i.number, p."amountCents", p."paidOn" FROM "Payment" p JOIN "Invoice" i ON i.id = p."invoiceId"
WHERE p."accountId" = 'acc_demo' AND p."xeroPaymentId" IS NULL AND p."createdAt" >= '<cutover>';
-- Count and total of what Track2 sent, to compare with Xero → Sales → Invoices (same date range, per org)
SELECT i."entityId", count(*), sum(i."totalCents")/100.0 AS total FROM "Invoice" i
WHERE i."accountId" = 'acc_demo' AND i."xeroInvoiceId" IS NOT NULL AND i."sentAt" >= '<cutover>' GROUP BY 1;
-- Open problems
SELECT "occurredAt", stage, message, "invoiceId" FROM "InvoiceEvent"
WHERE source = 'xero' AND level = 'error' AND "occurredAt" > now() - interval '30 days' ORDER BY 1 DESC;
```
In Xero, compare *Sales → Invoices* (count and total, same date range, per organisation) and the payment
account's reconciliation screen with the queries above. A Xero invoice that Track2 doesn't know about,
dated after the cutover, came from somewhere else: never from a Track2 retry, because retries look up by
number first.

**Not handled automatically:** deleting a payment in Track2 does not delete it in Xero. Void or delete it
in Xero by hand. A Xero invoice that is VOIDED or DELETED is not re-created, and the trace says so.
