/**
 * Seed safety guard (go-live P0).
 *
 * `prisma/seed.ts` starts by deleting the accounts `acc_demo` and `acc_globex` (cascade). In
 * production, `acc_demo` IS Big Sea's real account (388k time entries, 7.8k invoices), and
 * `prisma migrate reset` / `prisma db seed` run the seed automatically. So the seed refuses to run
 * unless BOTH:
 *   1. the operator opted in with ALLOW_SEED=1, and
 *   2. every target account that already exists looks like demo data (small, never migrated).
 *
 * The pure `evaluateSeedTargets` is unit-tested; `assertSeedAllowed` does the DB lookups.
 */
import type { PrismaClient } from '@prisma/client'

/** An existing account holding more than any of these is treated as real data. */
export const SEED_LIMITS = {
  timeEntries: 1000,
  invoices: 100,
  users: 50,
  /** Any Harvest id-map row or migration snapshot means the account was migrated. */
  migrationIdMaps: 0,
  migrationSnapshots: 0,
} as const

export interface SeedTargetStats {
  accountId: string
  name: string
  timeEntries: number
  invoices: number
  users: number
  migrationIdMaps: number
  migrationSnapshots: number
}

export type SeedVerdict = { ok: true } | { ok: false; reasons: string[] }

/** Decide whether the seed may wipe these accounts. `allowSeed` is the ALLOW_SEED env value. */
export function evaluateSeedTargets(allowSeed: string | undefined, targets: SeedTargetStats[]): SeedVerdict {
  const reasons: string[] = []
  if (allowSeed !== '1') {
    reasons.push('ALLOW_SEED=1 is not set. The seed deletes accounts and must be opted into explicitly.')
  }
  for (const t of targets) {
    const label = `account ${t.accountId} ("${t.name}")`
    if (t.timeEntries > SEED_LIMITS.timeEntries) reasons.push(`${label} has ${t.timeEntries.toLocaleString('en-US')} time entries (demo limit ${SEED_LIMITS.timeEntries}).`)
    if (t.invoices > SEED_LIMITS.invoices) reasons.push(`${label} has ${t.invoices.toLocaleString('en-US')} invoices (demo limit ${SEED_LIMITS.invoices}).`)
    if (t.users > SEED_LIMITS.users) reasons.push(`${label} has ${t.users} people (demo limit ${SEED_LIMITS.users}).`)
    if (t.migrationIdMaps > SEED_LIMITS.migrationIdMaps) reasons.push(`${label} has ${t.migrationIdMaps.toLocaleString('en-US')} Harvest id-map rows: it holds migrated Harvest data.`)
    if (t.migrationSnapshots > SEED_LIMITS.migrationSnapshots) reasons.push(`${label} has ${t.migrationSnapshots} Harvest backup snapshot(s): it holds migrated Harvest data.`)
  }
  return reasons.length ? { ok: false, reasons } : { ok: true }
}

export function formatSeedRefusal(reasons: string[], dbHost: string): string {
  const bar = '!'.repeat(78)
  return [
    '',
    bar,
    '  SEED REFUSED: nothing was deleted.',
    '',
    '  prisma/seed.ts DELETES the accounts acc_demo and acc_globex and everything in them',
    '  (time entries, invoices, payments, clients, projects, people). In production, acc_demo is',
    "  Big Sea's real account. `prisma migrate reset` and `prisma db seed` both run this seed.",
    '',
    `  Database host: ${dbHost}`,
    '',
    '  Why it refused:',
    ...reasons.map((r) => `    - ${r}`),
    '',
    '  Only seed a throwaway local/dev database:',
    '    ALLOW_SEED=1 DATABASE_URL=postgresql://localhost/... npm run db:seed',
    '  NEVER point DATABASE_URL at production (Supabase) when seeding.',
    bar,
    '',
  ].join('\n')
}

/** Host part of a connection string, for the refusal message (never prints credentials). */
export function dbHostOf(url: string | undefined): string {
  if (!url) return '(DATABASE_URL not set)'
  try {
    const u = new URL(url)
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`
  } catch {
    return '(unparseable DATABASE_URL)'
  }
}

/** Throws (with the loud explanation) unless the seed is allowed to wipe `accountIds`. */
export async function assertSeedAllowed(prisma: PrismaClient, accountIds: string[]): Promise<void> {
  const accounts = await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } })
  const targets: SeedTargetStats[] = []
  for (const a of accounts) {
    const where = { accountId: a.id }
    const [timeEntries, invoices, users, migrationIdMaps, migrationSnapshots] = await Promise.all([
      prisma.timeEntry.count({ where }),
      prisma.invoice.count({ where }),
      prisma.user.count({ where }),
      prisma.migrationIdMap.count({ where }),
      prisma.migrationSnapshot.count({ where }),
    ])
    targets.push({ accountId: a.id, name: a.name, timeEntries, invoices, users, migrationIdMaps, migrationSnapshots })
  }
  const verdict = evaluateSeedTargets(process.env.ALLOW_SEED, targets)
  if (!verdict.ok) {
    const err = new Error(formatSeedRefusal(verdict.reasons, dbHostOf(process.env.DATABASE_URL)))
    err.name = 'SeedRefused'
    throw err
  }
}
