/**
 * Invoice status banner (BugHerd #14): the big, color-coded "where does this invoice stand"
 * notice at the top of the internal invoice page, modeled on Harvest's.
 *
 * Pure derivation from the stored status (the INV-7 state machine in ./invoiceState) plus
 * dates and integer-cent amounts (INV-1). No I/O; the page only renders the result.
 */
import type { StoredStatus } from './invoiceState'
import { formatCents, formatDate } from '@/lib/format'

export type BannerKind = 'draft' | 'open' | 'partial' | 'overdue' | 'paid' | 'written_off' | 'closed'
export type BannerTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success' | 'muted'

export interface StatusBannerInput {
  status: StoredStatus
  dueDate: Date | null
  sentAt: Date | null
  totalCents: number
  paidCents: number
  /** most recent payment date (paid-on); used for "Paid on …" */
  lastPaymentOn: Date | null
  currency: string
}

export interface StatusBanner {
  kind: BannerKind
  tone: BannerTone
  /** short, big headline, e.g. "Overdue by 12 days" */
  headline: string
  /** the supporting key fact, e.g. "$1,200.00 due · was due 07/01/2026" */
  detail: string
  balanceCents: number
  /** whole days past the due date (open invoices only), else 0 */
  daysOverdue: number
  /** whole days until the due date (open, not yet due), else null */
  daysUntilDue: number | null
}

const DAY_MS = 86_400_000

/** Whole calendar days from `a` to `b`, comparing UTC dates (due dates are stored @db.Date). */
export function calendarDaysBetween(a: Date, b: Date): number {
  const ua = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())
  const ub = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())
  return Math.round((ub - ua) / DAY_MS)
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function deriveStatusBanner(v: StatusBannerInput, today: Date): StatusBanner {
  const balanceCents = v.totalCents - v.paidCents
  const money = (c: number) => formatCents(c, v.currency)
  const base = { balanceCents, daysOverdue: 0, daysUntilDue: null as number | null }

  switch (v.status) {
    case 'draft':
      return {
        ...base,
        kind: 'draft',
        tone: 'neutral',
        headline: 'Draft',
        detail: `Not sent yet · ${money(v.totalCents)} total`,
      }
    case 'paid':
      return {
        ...base,
        kind: 'paid',
        tone: 'success',
        headline: v.lastPaymentOn ? `Paid on ${formatDate(v.lastPaymentOn)}` : 'Paid in full',
        detail: `${money(v.paidCents)} received`,
      }
    case 'written_off':
      return {
        ...base,
        kind: 'written_off',
        tone: 'muted',
        headline: 'Written off',
        detail:
          v.paidCents > 0
            ? `${money(v.paidCents)} received · ${money(balanceCents)} written off`
            : `${money(balanceCents)} written off`,
      }
    case 'closed':
      return {
        ...base,
        kind: 'closed',
        tone: 'muted',
        headline: 'Closed',
        detail: v.paidCents > 0 ? `${money(v.paidCents)} received` : 'No payment expected',
      }
    case 'open':
      break
  }

  // open
  const partial = v.paidCents > 0 && balanceCents > 0
  const dueText = `${money(balanceCents)} due`
  const paidText = partial ? ` · ${money(v.paidCents)} of ${money(v.totalCents)} paid` : ''

  if (v.dueDate && balanceCents > 0) {
    const daysUntil = calendarDaysBetween(today, v.dueDate)
    if (daysUntil < 0) {
      const daysOverdue = -daysUntil
      return {
        ...base,
        kind: 'overdue',
        tone: 'danger',
        daysOverdue,
        headline: `Overdue by ${plural(daysOverdue, 'day')}`,
        detail: `${dueText} · was due ${formatDate(v.dueDate)}${paidText}`,
      }
    }
    const when = daysUntil === 0 ? 'Due today' : `Due in ${plural(daysUntil, 'day')}`
    return {
      ...base,
      kind: partial ? 'partial' : 'open',
      tone: partial ? 'warning' : 'info',
      daysUntilDue: daysUntil,
      headline: partial ? `Partially paid · ${when.toLowerCase()}` : `Sent · ${when.toLowerCase()}`,
      detail: `${dueText} on ${formatDate(v.dueDate)}${paidText}`,
    }
  }

  return {
    ...base,
    kind: partial ? 'partial' : 'open',
    tone: partial ? 'warning' : 'info',
    headline: partial ? 'Partially paid' : v.sentAt ? `Sent ${formatDate(v.sentAt)}` : 'Open',
    detail: `${dueText}${paidText}`,
  }
}
