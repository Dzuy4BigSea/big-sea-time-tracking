/**
 * Invoice list status filter and tabs (specs/27 AC-STAT-004/005/006), matching Harvest's
 * Invoices > Overview:
 *  - Open tab = every invoice not fully paid, INCLUDING drafts (draft + open).
 *  - Status filter options, in Harvest's order: all, open, closed, draft, sent, late.
 *    Closed = paid + written off + closed. Sent/Late split open invoices by the calendar due date
 *    (Late = due date before today, account timezone — same rule as displayBadge/isPastDue).
 *
 * Pure: returns a Prisma `where` fragment; the page combines it with accountId (INV-5) and the
 * other filters.
 */
import type { Prisma } from '@prisma/client'
import type { StoredStatus } from './invoiceState'

export type InvoiceTab = 'open' | 'all'
export type StatusFilter = 'all' | 'open' | 'closed' | 'draft' | 'sent' | 'late'

export const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'late', label: 'Late' },
]

export const OPEN_STATUSES: StoredStatus[] = ['draft', 'open']
export const CLOSED_STATUSES: StoredStatus[] = ['paid', 'written_off', 'closed']

export function parseStatusFilter(raw: unknown): StatusFilter {
  const v = String(raw ?? '')
  return STATUS_FILTERS.some((f) => f.value === v) ? (v as StatusFilter) : 'all'
}

/** `where` for the tab (Open includes drafts). */
export function tabWhere(tab: InvoiceTab): Prisma.InvoiceWhereInput {
  return tab === 'open' ? { status: { in: OPEN_STATUSES } } : {}
}

/** `where` for a status filter. `today` = the account's calendar day (UTC-midnight date). */
export function statusFilterWhere(filter: StatusFilter, today: Date): Prisma.InvoiceWhereInput {
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  switch (filter) {
    case 'open':
      return { status: { in: OPEN_STATUSES } }
    case 'closed':
      return { status: { in: CLOSED_STATUSES } }
    case 'draft':
      return { status: 'draft' }
    case 'sent':
      return { status: 'open', OR: [{ dueDate: null }, { dueDate: { gte: day } }] }
    case 'late':
      return { status: 'open', dueDate: { lt: day } }
    case 'all':
    default:
      return {}
  }
}

/**
 * The small date under a list badge (AC-STAT-006; Harvest `status_badge_date`): the sent date for
 * a Sent invoice, the paid-on date for a Paid one, nothing otherwise. Wording UNVERIFIED.
 */
export function badgeDateLabel(
  badge: 'draft' | 'sent' | 'pending' | 'late' | 'paid' | 'written_off' | 'closed',
  sentAt: Date | null,
  lastPaidOn: Date | null,
  fmt: (d: Date) => string,
): string | null {
  if (badge === 'sent' && sentAt) return `Sent ${fmt(sentAt)}`
  if (badge === 'paid' && lastPaidOn) return `Paid ${fmt(lastPaidOn)}`
  return null
}
