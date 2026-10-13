/**
 * Go-live safety for the Harvest → Track2 importer (pure, unit-tested).
 *
 * Once people use Track2 for real work, a Harvest delta must never clobber what happened in Track2:
 *  - time entries that Track2 has locked, invoiced, approved or that are running,
 *  - time entries edited in Track2 after they were imported,
 *  - invoices created or changed in Track2 (their line items are never rebuilt).
 *
 * How "edited in Track2" is detected without a schema change: whenever the importer (or
 * scripts/rebuild-timesheets.mjs) writes a Harvest time entry it stamps `updatedAt` with Harvest's own
 * `updated_at`, which has whole-second precision (`.000` ms). Any edit made in Track2 sets
 * `updatedAt = now()` with millisecond precision. So an entry is still exactly as imported when its
 * `updatedAt` is import-stamped (0 ms) or equals its `createdAt` (created by a bulk import and never
 * touched). Anything else was modified in Track2 and is protected. A Track2 edit that happens to land
 * on .000 ms (1 in 1000) is still caught when Harvest's version is not newer than it.
 */

export const MIGRATION_LOCKED_MESSAGE =
  'Migration is locked (MIGRATION_LOCKED=1): Track2 is the system of record, so Harvest backups and imports are disabled. ' +
  'Unset MIGRATION_LOCKED in the environment only if you really need to run another Harvest sync.'

/** Hard kill switch: env MIGRATION_LOCKED=1 (also accepts "true"/"yes"). */
export function isMigrationLocked(env: Record<string, string | undefined> = process.env): boolean {
  const v = String(env.MIGRATION_LOCKED ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/** Slack between createdAt and updatedAt for rows written by one create (Prisma sets both). */
const SAME_WRITE_MS = 2000

/** True when the row's timestamps say it has not been edited since an import wrote it. */
export function isImportStamped(row: { createdAt: Date; updatedAt: Date }): boolean {
  const u = row.updatedAt.getTime()
  if (u % 1000 === 0) return true // stamped with Harvest's whole-second updated_at
  return Math.abs(u - row.createdAt.getTime()) <= SAME_WRITE_MS // created by a bulk import, never updated
}

/** Harvest `updated_at` as a Date (whole seconds), or null. */
export function harvestUpdatedAt(v: unknown): Date | null {
  if (!v) return null
  const d = new Date(String(v))
  if (isNaN(d.getTime())) return null
  return new Date(Math.floor(d.getTime() / 1000) * 1000)
}

export type ExistingTimeEntry = {
  lockState: string
  invoiceLineItemId: string | null
  approvedTimesheetId: string | null
  isRunning: boolean
  createdAt: Date
  updatedAt: Date
}

export type UpdateDecision =
  | { action: 'update' }
  | { action: 'skip'; reason: 'invoiced_in_track2' | 'approved_in_track2' | 'running' | 'locked' | 'edited_in_track2' | 'unchanged' }

/**
 * Should an incoming Harvest row overwrite this existing Track2 time entry?
 * Conservative by design: when in doubt, keep Track2's copy and report the skip.
 */
export function decideTimeEntryUpdate(existing: ExistingTimeEntry, incomingUpdatedAt: Date | null): UpdateDecision {
  if (existing.invoiceLineItemId) return { action: 'skip', reason: 'invoiced_in_track2' }
  if (existing.approvedTimesheetId) return { action: 'skip', reason: 'approved_in_track2' }
  if (existing.isRunning) return { action: 'skip', reason: 'running' }
  if (existing.lockState !== 'open') return { action: 'skip', reason: 'locked' } // INV-3
  if (!isImportStamped(existing)) return { action: 'skip', reason: 'edited_in_track2' }
  // Re-importing an older snapshot must never roll an entry back: when the row carries a Harvest
  // stamp, only a strictly newer Harvest version replaces it.
  const stamp = existing.updatedAt.getTime()
  if (incomingUpdatedAt && stamp % 1000 === 0 && stamp >= incomingUpdatedAt.getTime()) {
    return { action: 'skip', reason: 'unchanged' }
  }
  return { action: 'update' }
}

/** Expenses: never overwrite one that Track2 has put on an invoice or locked. */
export function decideExpenseUpdate(existing: { lockState: string; invoiceLineItemId: string | null }): UpdateDecision {
  if (existing.invoiceLineItemId) return { action: 'skip', reason: 'invoiced_in_track2' }
  if (existing.lockState !== 'open') return { action: 'skip', reason: 'locked' }
  return { action: 'update' }
}

/** Audit summaries the importer itself writes (anything else on an invoice came from Track2). */
export const IMPORT_AUDIT_PREFIXES = ['Imported from Harvest', 'Invoice sent to client', 'Payment recorded — $', 'Closed', 'Written off'] as const
export const IMPORTED_PAYMENT_NOTE = 'Imported from Harvest'

export type InvoiceTrack2Activity = {
  /** Audit rows on the invoice: actor + summary. */
  audits: { actorUserId: string | null; summary: string | null }[]
  /** Payment notes on the invoice. */
  paymentNotes: (string | null)[]
  /** Time entries + expenses linked (via invoiceLineItemId) to its line items. */
  linkedItems: number
  /** Set when the invoice has a Xero copy, Stripe intent or public token minted by Track2. */
  externalIds: boolean
}

/**
 * True when Track2 has touched this imported invoice (sent, paid, edited, linked time, copied to
 * Xero, ...). The importer then leaves the invoice, its line items and payments alone.
 */
export function invoiceChangedInTrack2(a: InvoiceTrack2Activity): boolean {
  if (a.linkedItems > 0) return true
  if (a.externalIds) return true
  if (a.paymentNotes.some((n) => n !== IMPORTED_PAYMENT_NOTE)) return true
  return a.audits.some((x) => {
    if (x.actorUserId) return true // a person did something in Track2
    const s = x.summary ?? ''
    return !IMPORT_AUDIT_PREFIXES.some((p) => s.startsWith(p))
  })
}

/** Numeric max of document numbers that end in digits ('999' < '7801'), as a pure fallback. */
export function numericMaxDocNumber(numbers: (string | null | undefined)[]): number | null {
  let max: number | null = null
  for (const n of numbers) {
    const m = /(\d+)\s*$/.exec(String(n ?? ''))
    if (!m) continue
    const v = Number(m[1])
    if (Number.isSafeInteger(v) && (max === null || v > max)) max = v
  }
  return max
}
