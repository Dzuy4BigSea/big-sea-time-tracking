/**
 * Invoice status banner (BugHerd #14): the big, color-coded "where does this invoice stand"
 * notice at the top of the internal invoice page. Headlines use Harvest's status vocabulary
 * (Draft, Sent, Late, Paid, Written off; specs/findings.md) and its colors (AC-UI-003: gray Draft,
 * blue Sent, red Late, green Paid). A partly paid invoice is still Sent (or Late) in Harvest; the
 * partial payment shows in the detail line.
 *
 * Pure derivation from the stored status (the INV-7 state machine in ./invoiceState) plus
 * dates and integer-cent amounts (INV-1). No I/O; the page only renders the result.
 */
import type { StoredStatus } from './invoiceState'
import { formatCents, formatDate } from '@/lib/format'

export type BannerKind = 'draft' | 'sent' | 'late' | 'paid' | 'written_off' | 'closed'
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
  /** Harvest status word: Draft, Sent, Late, Paid, Written off, Closed */
  headline: string
  /** the supporting key fact, e.g. "12 days late · $1,200.00 due · was due 07/01/2026" */
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
        headline: 'Paid',
        detail: v.lastPaymentOn
          ? `Paid on ${formatDate(v.lastPaymentOn)} · ${money(v.paidCents)} received`
          : `${money(v.paidCents)} received`,
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

  // open: Sent, or Late once past due (Harvest has no separate "partial" status, and shows Late
  // even for a $0 balance — specs/27 AC-STAT-002). Same rule as displayBadge/isPastDue.
  const partial = v.paidCents > 0 && balanceCents > 0
  const dueText = `${money(balanceCents)} due`
  const paidText = partial ? ` · ${money(v.paidCents)} of ${money(v.totalCents)} paid` : ''

  if (v.dueDate) {
    const daysUntil = calendarDaysBetween(today, v.dueDate)
    if (daysUntil < 0) {
      const daysOverdue = -daysUntil
      return {
        ...base,
        kind: 'late',
        tone: 'danger',
        daysOverdue,
        headline: 'Late',
        detail: `${plural(daysOverdue, 'day')} late · ${dueText} · was due ${formatDate(v.dueDate)}${paidText}`,
      }
    }
    const when = daysUntil === 0 ? 'Due today' : `Due in ${plural(daysUntil, 'day')}`
    return {
      ...base,
      kind: 'sent',
      tone: 'info',
      daysUntilDue: daysUntil,
      headline: 'Sent',
      detail: `${when} · ${dueText} on ${formatDate(v.dueDate)}${paidText}`,
    }
  }

  return {
    ...base,
    kind: 'sent',
    tone: 'info',
    headline: 'Sent',
    detail: `${v.sentAt ? `Sent ${formatDate(v.sentAt)} · ` : ''}${dueText}${paidText}`,
  }
}

/**
 * The note after "Balance: $1,500.00" in the invoice action row (Harvest): "(6 days late)" in red,
 * "(due in 3 days)" / "(due today)" otherwise. Open invoices only; null for every other state.
 */
export function balanceNote(b: StatusBanner): { text: string; late: boolean } | null {
  if (b.kind === 'late') return { text: `(${plural(b.daysOverdue, 'day')} late)`, late: true }
  if (b.kind === 'sent' && b.daysUntilDue != null) {
    return { text: b.daysUntilDue === 0 ? '(due today)' : `(due in ${plural(b.daysUntilDue, 'day')})`, late: false }
  }
  return null
}
