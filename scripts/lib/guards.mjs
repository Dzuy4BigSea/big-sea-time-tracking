/**
 * Shared safety guards for the ops/migration scripts (go-live data safety).
 *
 * Conventions every destructive script follows:
 *   - DRY RUN by default; writes need an explicit flag (--confirm / --apply).
 *   - ACCOUNT_ID must be given explicitly for anything that deletes (no "find the Big Sea account").
 *   - MIGRATION_LOCKED=1 (the same kill switch the app honours) refuses every Harvest → Track2 write.
 *   - Wipes/rebuilds refuse on production-sized data.
 */

/** Same threshold as prisma/seedGuard.ts: anything above this is real data, not a demo. */
export const PROD_TIME_ENTRY_THRESHOLD = 1000

export const has = (flag) => process.argv.includes(flag)

export function dbHost() {
  const url = process.env.DATABASE_URL
  if (!url) return '(DATABASE_URL not set)'
  try {
    const u = new URL(url)
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`
  } catch {
    return '(unparseable DATABASE_URL)'
  }
}

/** Print a loud refusal and exit non-zero. Nothing has been written when this is called. */
export function refuse(title, lines = []) {
  const bar = '!'.repeat(78)
  console.error(['', bar, `  REFUSED: ${title}`, '  Nothing was changed.', '', ...lines.map((l) => `  ${l}`), '', `  Database host: ${dbHost()}`, bar, ''].join('\n'))
  process.exit(2)
}

export function isMigrationLocked() {
  const v = String(process.env.MIGRATION_LOCKED ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/** Refuse when the MIGRATION_LOCKED kill switch is on (only call this on write paths). */
export function assertNotLocked(what) {
  if (isMigrationLocked()) {
    refuse(`${what} is disabled: MIGRATION_LOCKED=1`, [
      'Track2 is the system of record, so Harvest → Track2 writes are locked.',
      'Unset MIGRATION_LOCKED only if you deliberately need another Harvest sync.',
    ])
  }
}

/** ACCOUNT_ID from the environment, required (no name lookup), and it must exist. */
export async function requireAccountId(p) {
  const accountId = process.env.ACCOUNT_ID
  if (!accountId) {
    refuse('ACCOUNT_ID is required', ['Pass the account explicitly, e.g. ACCOUNT_ID=acc_xxx node scripts/<script>.mjs', 'Scripts that write never guess the account by name.'])
  }
  const account = await p.account.findUnique({ where: { id: accountId }, select: { id: true, name: true } })
  if (!account) refuse(`account ${accountId} not found`)
  return account
}
