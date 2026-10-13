# Track2 operations: backups, restore, health check, data-safety guards

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

- `.github/workflows/ci.yml`: on every PR and push to `main`: `npm ci`, `prisma generate`, `tsc --noEmit`,
  `npm test` with `TZ=America/New_York` (catches UTC-midnight date bugs), `npm run build` with dummy env.
- `.github/workflows/db-backup.yml`: nightly at 07:17 UTC and on demand (Actions → DB backup → Run
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

- Reports → Export CSV (`/reports/export`) and the detailed time CSV (`/reports/detailed/export`) now
  stream in keyset-paginated batches of 2,000 rows; same columns and permission checks as before.
- Settings → **Data export** (`/settings/export`, admins with `edit_account_settings`): one streamed CSV
  per table (time entries, invoices, invoice line items, payments, clients, contacts, projects, people,
  expenses), every column except password hashes and tokens, scoped to the signed-in account.
