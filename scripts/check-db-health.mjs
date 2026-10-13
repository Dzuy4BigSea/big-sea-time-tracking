#!/usr/bin/env node
/**
 * Read-only production health check (go-live). Run it against any DATABASE_URL; it only SELECTs
 * (and asks Postgres to make the session read-only as a belt-and-braces measure).
 *
 * Checks:
 *   1. Schema objects: every index and constraint named in prisma/migrations/*\/migration.sql and
 *      prisma/sql/constraints.sql exists (production was baselined with `db push` + `migrate resolve`,
 *      so raw-SQL objects such as one_running_timer_per_user may never have been created there).
 *   2. `_prisma_migrations`: applied / failed / rolled back / missing / unknown migrations.
 *   3. Per account: invoice + estimate number sequence vs the NUMERIC max of existing numbers (INV-6).
 *   4. Leftover demo data: users @bigsea.demo / @globex.demo, accounts other than acc_demo.
 *   5. Running timers started more than 12 hours ago.
 *
 * Usage:
 *   node --env-file=.env scripts/check-db-health.mjs                 # exit 0 = healthy, 1 = problems found
 *   DATABASE_URL=postgresql://... node scripts/check-db-health.mjs
 * Env: PROD_ACCOUNT_ID (default acc_demo), STALE_TIMER_HOURS (default 12).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { dbHost } from './lib/guards.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROD_ACCOUNT_ID = process.env.PROD_ACCOUNT_ID ?? 'acc_demo'
const STALE_HOURS = Number(process.env.STALE_TIMER_HOURS ?? 12)

// ---- expected schema objects from the migration files -------------------------------------------
function expectedObjects() {
  const migDir = join(ROOT, 'prisma', 'migrations')
  const dirs = readdirSync(migDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  const files = dirs.map((d) => join(migDir, d, 'migration.sql')).filter(existsSync)
  const constraintsSql = join(ROOT, 'prisma', 'sql', 'constraints.sql')
  if (existsSync(constraintsSql)) files.push(constraintsSql)
  const indexes = new Map() // name -> source
  const constraints = new Map()
  for (const f of files) {
    // Strip -- comments so commented-out DDL is ignored.
    const sql = readFileSync(f, 'utf8').replace(/--[^\n]*/g, '')
    const src = f.slice(ROOT.length + 1)
    // Statements in file order so a later DROP cancels an earlier CREATE.
    for (const stmt of sql.split(';')) {
      let m
      const idx = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?/gi
      while ((m = idx.exec(stmt))) indexes.set(m[1], src)
      const dropIdx = /DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?/gi
      while ((m = dropIdx.exec(stmt))) indexes.delete(m[1])
      const renIdx = /ALTER\s+INDEX\s+"?([A-Za-z0-9_]+)"?\s+RENAME\s+TO\s+"?([A-Za-z0-9_]+)"?/gi
      while ((m = renIdx.exec(stmt))) { indexes.delete(m[1]); indexes.set(m[2], src) }
      const dropCon = /DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?/gi
      const dropped = new Set()
      while ((m = dropCon.exec(stmt))) { constraints.delete(m[1]); dropped.add(m[1]) }
      const con = /(?<!DROP\s)CONSTRAINT\s+"?([A-Za-z0-9_]+)"?/gi
      while ((m = con.exec(stmt))) if (!dropped.has(m[1])) constraints.set(m[1], src)
      const renCon = /RENAME\s+CONSTRAINT\s+"?([A-Za-z0-9_]+)"?\s+TO\s+"?([A-Za-z0-9_]+)"?/gi
      while ((m = renCon.exec(stmt))) { constraints.delete(m[1]); constraints.set(m[2], src) }
    }
  }
  // Unique indexes created with CREATE UNIQUE INDEX also satisfy "constraints" of the same name.
  return { dirs, indexes, constraints }
}

const p = new PrismaClient({ datasources: { db: { url: withSingleConnection(process.env.DATABASE_URL) } } })
function withSingleConnection(url) {
  if (!url) return url
  try {
    const u = new URL(url)
    if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '1')
    return u.toString()
  } catch {
    return url
  }
}

const problems = []
const warn = []
const line = (s = '') => process.stdout.write(s + '\n')
const head = (s) => line(`\n== ${s} ${'='.repeat(Math.max(0, 72 - s.length))}`)

try {
  await p.$executeRawUnsafe('SET SESSION default_transaction_read_only = on')
} catch {
  /* pgbouncer transaction mode may reject SET; every query below is a SELECT anyway */
}

line(`Track2 DB health check — ${new Date().toISOString()}`)
line(`Database: ${dbHost()}   (read-only)`)
const [ver] = await p.$queryRawUnsafe(`SELECT current_database() AS db, current_schema() AS schema, version() AS version, current_setting('TimeZone') AS tz`)
line(`Postgres: ${String(ver.version).split(',')[0]}   db=${ver.db} schema=${ver.schema} TimeZone=${ver.tz}`)

// 1. schema objects
head('1. Indexes and constraints from migrations')
const { dirs, indexes, constraints } = expectedObjects()
const dbIdx = new Set((await p.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()`)).map((r) => r.indexname))
const dbCon = new Set((await p.$queryRawUnsafe(`SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = current_schema()`)).map((r) => r.conname))
const missingIdx = [...indexes].filter(([n]) => !dbIdx.has(n))
const missingCon = [...constraints].filter(([n]) => !dbCon.has(n) && !dbIdx.has(n))
line(`  expected indexes: ${indexes.size}  missing: ${missingIdx.length}`)
for (const [n, src] of missingIdx) { line(`    MISSING INDEX      ${n}   (${src})`); problems.push(`missing index ${n}`) }
line(`  expected constraints: ${constraints.size}  missing: ${missingCon.length}`)
for (const [n, src] of missingCon) { line(`    MISSING CONSTRAINT ${n}   (${src})`); problems.push(`missing constraint ${n}`) }
const ext = await p.$queryRawUnsafe(`SELECT extname FROM pg_extension WHERE extname = 'btree_gist'`)
line(`  btree_gist extension: ${ext.length ? 'present' : 'MISSING'}`)
if (!ext.length) problems.push('btree_gist extension missing (rate no-overlap constraints need it)')
if (missingIdx.length || missingCon.length) {
  line('  Fix: apply the missing objects by hand from the SQL named above, e.g.')
  line('    psql "$DATABASE_URL" -f prisma/sql/constraints.sql   (idempotent for the timer index; check ADD CONSTRAINT first)')
}

// 2. _prisma_migrations
head('2. _prisma_migrations')
const hasMigTable = (await p.$queryRawUnsafe(`SELECT to_regclass(current_schema() || '._prisma_migrations') IS NOT NULL AS ok`))[0].ok
if (!hasMigTable) {
  line('  _prisma_migrations table is MISSING (database never baselined).')
  problems.push('_prisma_migrations missing')
} else {
  const rows = await p.$queryRawUnsafe(`SELECT migration_name, finished_at, rolled_back_at, started_at, logs FROM _prisma_migrations ORDER BY started_at`)
  const applied = new Set(rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name))
  const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at)
  const rolledBack = rows.filter((r) => r.rolled_back_at)
  const notApplied = dirs.filter((d) => !applied.has(d))
  const unknown = [...applied].filter((n) => !dirs.includes(n))
  line(`  local migrations: ${dirs.length}  applied: ${applied.size}  failed: ${failed.length}  rolled back: ${rolledBack.length}`)
  for (const d of notApplied) { line(`    NOT APPLIED  ${d}`); problems.push(`migration not applied: ${d}`) }
  for (const r of failed) { line(`    FAILED       ${r.migration_name}  started ${new Date(r.started_at).toISOString()}  ${String(r.logs ?? '').slice(0, 120)}`); problems.push(`migration failed: ${r.migration_name}`) }
  for (const r of rolledBack) line(`    rolled back  ${r.migration_name}`)
  for (const n of unknown) { line(`    UNKNOWN      ${n} (in DB, not in this checkout)`); warn.push(`unknown migration in DB: ${n}`) }
  if (!notApplied.length && !failed.length) line('  ok: every local migration is applied')
}

// 3. number sequences
head('3. Invoice / estimate number sequences (INV-6)')
const accounts = await p.$queryRawUnsafe(`SELECT id, name, "invoiceNumberSeq", "estimateNumberSeq" FROM "Account" ORDER BY id`)
const numericMax = async (table, accountId) => {
  const [r] = await p.$queryRawUnsafe(
    `SELECT MAX((substring("number" from '([0-9]+)[[:space:]]*$'))::bigint) AS max FROM "${table}"
      WHERE "accountId" = $1 AND "number" ~ '[0-9]+[[:space:]]*$'`, accountId)
  const [a] = await p.$queryRawUnsafe(`SELECT MAX("number") AS max FROM "${table}" WHERE "accountId" = $1`, accountId)
  return { numeric: r.max == null ? null : Number(r.max), alpha: a.max }
}
for (const a of accounts) {
  const inv = await numericMax('Invoice', a.id)
  const est = await numericMax('Estimate', a.id)
  const invBad = inv.numeric != null && a.invoiceNumberSeq < inv.numeric
  const estBad = est.numeric != null && a.estimateNumberSeq < est.numeric
  line(`  ${a.id} (${a.name})`)
  line(`    invoices : seq=${a.invoiceNumberSeq}  numeric max=${inv.numeric ?? '—'}  alphabetical max='${inv.alpha ?? '—'}'  ${invBad ? 'BEHIND → next send can reuse a number' : 'ok'}`)
  line(`    estimates: seq=${a.estimateNumberSeq}  numeric max=${est.numeric ?? '—'}  alphabetical max='${est.alpha ?? '—'}'  ${estBad ? 'BEHIND' : 'ok'}`)
  if (invBad || estBad) problems.push(`number sequence behind for ${a.id}: run ACCOUNT_ID=${a.id} node scripts/fix-number-sequences.mjs`)
}

// 4. demo leftovers
head('4. Demo / seed leftovers')
const demoUsers = await p.$queryRawUnsafe(
  `SELECT "accountId", email FROM "User" WHERE email ILIKE '%@bigsea.demo' OR email ILIKE '%@globex.demo' ORDER BY "accountId", email`)
line(`  demo users (@bigsea.demo / @globex.demo): ${demoUsers.length}`)
for (const u of demoUsers.slice(0, 25)) line(`    ${u.accountId}  ${u.email}`)
if (demoUsers.length > 25) line(`    … ${demoUsers.length - 25} more`)
if (demoUsers.length) warn.push(`${demoUsers.length} demo users still exist (password123 logins!)`)
const otherAccounts = accounts.filter((a) => a.id !== PROD_ACCOUNT_ID)
line(`  accounts other than ${PROD_ACCOUNT_ID}: ${otherAccounts.length}`)
for (const a of otherAccounts) {
  const [c] = await p.$queryRawUnsafe(
    `SELECT (SELECT COUNT(*) FROM "User" WHERE "accountId" = $1)::int AS users, (SELECT COUNT(*) FROM "TimeEntry" WHERE "accountId" = $1)::int AS te,
            (SELECT COUNT(*) FROM "Invoice" WHERE "accountId" = $1)::int AS inv`, a.id)
  line(`    ${a.id} (${a.name}): users=${c.users} timeEntries=${c.te} invoices=${c.inv}`)
  warn.push(`extra account ${a.id}`)
}
const prod = accounts.find((a) => a.id === PROD_ACCOUNT_ID)
if (prod) {
  const [c] = await p.$queryRawUnsafe(
    `SELECT (SELECT COUNT(*) FROM "TimeEntry" WHERE "accountId" = $1)::int AS te, (SELECT COUNT(*) FROM "Invoice" WHERE "accountId" = $1)::int AS inv,
            (SELECT COUNT(*) FROM "MigrationIdMap" WHERE "accountId" = $1)::int AS idmap`, PROD_ACCOUNT_ID)
  line(`  ${PROD_ACCOUNT_ID} (${prod.name}): timeEntries=${c.te} invoices=${c.inv} harvestIdMaps=${c.idmap}`)
  if (/demo/i.test(prod.name)) warn.push(`production account is still named "${prod.name}" (shows on invoices)`)
}

// 5. stale timers
head(`5. Running timers older than ${STALE_HOURS}h`)
const stale = await p.$queryRawUnsafe(
  `SELECT te.id, te."accountId", u.email, te."timerStartedAt" FROM "TimeEntry" te JOIN "User" u ON u.id = te."userId"
    WHERE te."isRunning" AND (te."timerStartedAt" IS NULL OR te."timerStartedAt" < now() - make_interval(hours => $1::int))
    ORDER BY te."timerStartedAt" NULLS FIRST LIMIT 50`, STALE_HOURS)
line(`  stale running timers: ${stale.length}`)
for (const t of stale) line(`    ${t.accountId}  ${t.email}  started ${t.timerStartedAt ? new Date(t.timerStartedAt).toISOString() : '(no start time)'}  entry ${t.id}`)
if (stale.length) warn.push(`${stale.length} running timer(s) older than ${STALE_HOURS}h`)

// summary
head('Summary')
if (!problems.length && !warn.length) line('  HEALTHY: no problems found.')
for (const x of problems) line(`  PROBLEM  ${x}`)
for (const x of warn) line(`  WARN     ${x}`)
await p.$disconnect()
process.exit(problems.length ? 1 : 0)
