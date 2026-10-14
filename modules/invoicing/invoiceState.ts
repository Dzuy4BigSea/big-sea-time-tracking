/**
 * Invoice state machine (specs/05-invoicing.md §State machine).
 *
 * Pure, guarded transitions — the single reference for INV-7 ("only guarded transitions").
 * Stored status vs display badge are separate concerns (see displayBadge).
 *
 *        send            payment≥total
 *   draft ───▶ open ───────────────▶ paid
 *     ▲          │ ▲                    │
 *     └ mark_as_draft (releases)  delete_payment (re-derive)
 *   draft/open ─delete▶ (removed)   open/paid ─close/write_off▶ closed/written_off
 *   written_off ─reopen▶ open (Harvest "Re-open Invoice")
 */

export type StoredStatus = 'draft' | 'open' | 'paid' | 'written_off' | 'closed'
export type DisplayBadge = 'draft' | 'sent' | 'pending' | 'late' | 'paid' | 'written_off' | 'closed'

export type InvoiceAction =
  | 'send'
  | 'record_payment'
  | 'delete_payment'
  | 'mark_as_draft'
  | 'write_off'
  | 'close'
  | 'reopen'
  | 'delete'

export class InvalidTransitionError extends Error {
  constructor(from: StoredStatus, action: InvoiceAction, reason?: string) {
    super(`Illegal invoice transition: ${action} from "${from}"${reason ? ` — ${reason}` : ''}`)
    this.name = 'InvalidTransitionError'
  }
}

/** Which actions are legal from each stored status (terminal states allow none). */
const LEGAL: Record<StoredStatus, ReadonlySet<InvoiceAction>> = {
  draft: new Set(['send', 'delete']),
  open: new Set(['record_payment', 'delete_payment', 'mark_as_draft', 'write_off', 'close', 'delete']),
  paid: new Set(['delete_payment', 'close']),
  // Harvest "Re-open Invoice" (specs/27 AC-STAT-007).
  written_off: new Set(['reopen']),
  closed: new Set(),
}

/** Why delete / mark-as-draft is refused once money has been received. */
export const PAID_BLOCK_REASON = 'payments have been recorded — delete the payments first'

export function canTransition(from: StoredStatus, action: InvoiceAction): boolean {
  return LEGAL[from].has(action)
}

/** Status implied by payment progress. Full payment → paid; otherwise open. */
export function deriveStatusAfterPayment(totalCents: number, paidCents: number): StoredStatus {
  return totalCents > 0 && paidCents >= totalCents ? 'paid' : 'open'
}

export interface InvoiceState {
  status: StoredStatus
  totalCents: number
  paidCents: number
  lineItemCount: number
  sentAt: Date | null
  number: string | null
}

export interface ActionContext {
  /** for record_payment / delete_payment */
  amountCents?: number
  allowOverpayment?: boolean
  /** for send: current account.invoiceNumberSeq (last used) */
  lastInvoiceNumberSeq?: number
}

export interface TransitionResult {
  status: StoredStatus
  paidCents: number
  /** side effects the caller must perform in the same transaction */
  effects: {
    assignNumber?: string
    nextInvoiceNumberSeq?: number
    setSentAt?: boolean
    lockEntries?: boolean
    issuePublicToken?: boolean
    releaseEntries?: boolean
    retainNumber?: boolean
    deleteInvoice?: boolean
  }
}

/** Apply a guarded action. Throws InvalidTransitionError on an illegal/ungated transition. */
export function applyInvoiceAction(state: InvoiceState, action: InvoiceAction, ctx: ActionContext = {}): TransitionResult {
  if (!canTransition(state.status, action)) throw new InvalidTransitionError(state.status, action)

  switch (action) {
    case 'send': {
      if (state.lineItemCount < 1) throw new InvalidTransitionError(state.status, action, 'requires ≥1 line item')
      // Re-send after mark-as-draft keeps the number it was first given (AC-INV-013, INV-6).
      if (state.number) {
        return {
          status: deriveStatusAfterPayment(state.totalCents, state.paidCents) === 'paid' ? 'paid' : 'open',
          paidCents: state.paidCents,
          effects: { retainNumber: true, setSentAt: true, lockEntries: true, issuePublicToken: true },
        }
      }
      const seq = (ctx.lastInvoiceNumberSeq ?? 0) + 1
      return {
        status: 'open',
        paidCents: state.paidCents,
        effects: {
          assignNumber: String(seq),
          nextInvoiceNumberSeq: seq,
          setSentAt: true,
          lockEntries: true,
          issuePublicToken: true,
        },
      }
    }

    case 'record_payment': {
      const amount = ctx.amountCents ?? 0
      if (amount <= 0) throw new InvalidTransitionError(state.status, action, 'payment must be > 0')
      const newPaid = state.paidCents + amount
      const due = state.totalCents - state.paidCents
      if (!ctx.allowOverpayment && amount > due) {
        throw new InvalidTransitionError(state.status, action, 'overpayment not allowed')
      }
      return { status: deriveStatusAfterPayment(state.totalCents, newPaid), paidCents: newPaid, effects: {} }
    }

    case 'delete_payment': {
      const amount = ctx.amountCents ?? 0
      const newPaid = Math.max(0, state.paidCents - amount)
      return { status: deriveStatusAfterPayment(state.totalCents, newPaid), paidCents: newPaid, effects: {} }
    }

    case 'mark_as_draft':
      if (state.paidCents > 0) throw new InvalidTransitionError(state.status, action, PAID_BLOCK_REASON)
      // Reverts to draft, releases reserved entries, but keeps the already-assigned number.
      return { status: 'draft', paidCents: state.paidCents, effects: { releaseEntries: true, retainNumber: true } }

    case 'write_off':
      return { status: 'written_off', paidCents: state.paidCents, effects: {} }

    case 'close':
      return { status: 'closed', paidCents: state.paidCents, effects: {} }

    case 'reopen':
      // Written off → open again: number, entries (still locked) and payments are kept; a balance
      // that is somehow fully paid re-derives to paid.
      return { status: deriveStatusAfterPayment(state.totalCents, state.paidCents), paidCents: state.paidCents, effects: {} }

    case 'delete':
      if (state.paidCents > 0) throw new InvalidTransitionError(state.status, action, PAID_BLOCK_REASON)
      // Allowed from draft AND sent (observed). Releases entries back to the pool.
      return { status: state.status, paidCents: state.paidCents, effects: { deleteInvoice: true, releaseEntries: true } }
  }
}

/**
 * Status after the invoice total changes (tax/discount/line edits) on a sent invoice. The total may
 * never drop below what has already been paid; returns the re-derived status or throws.
 */
export function deriveStatusAfterTotalChange(status: StoredStatus, newTotalCents: number, paidCents: number): StoredStatus {
  if (status !== 'open' && status !== 'paid') return status
  if (newTotalCents < paidCents) {
    throw new InvalidTransitionError(status, 'record_payment', 'the new total would be less than the amount already paid')
  }
  return paidCents > 0 ? deriveStatusAfterPayment(newTotalCents, paidCents) : 'open'
}

/**
 * First invoice number at or after `seq` that is not already used. Imported (Harvest) numbers can
 * sit above the account sequence, so the allocator skips forward instead of colliding (INV-6).
 */
export function firstFreeInvoiceSeq(seq: number, takenNumbers: Iterable<string>): number {
  const taken = new Set(takenNumbers)
  let n = seq
  while (taken.has(String(n))) n++
  return n
}

/** A user-facing message for an InvalidTransitionError (strips the internal prefix). */
export function transitionErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof InvalidTransitionError) {
    const m = /— (.+)$/.exec(e.message)
    if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1) + '.'
    return 'That action is not allowed for this invoice in its current state.'
  }
  return fallback
}

export interface BadgeView {
  status: StoredStatus
  sentAt: Date | null
  dueDate: Date | null
  totalCents: number
  paidCents: number
  /** queued to send / awaiting settlement */
  isPending?: boolean
}

/** Derive the display badge shown in lists/reports from stored status + dates. */
export function displayBadge(v: BadgeView, today: Date): DisplayBadge {
  if (v.status === 'draft') return 'draft'
  if (v.status === 'paid') return 'paid'
  if (v.status === 'written_off') return 'written_off'
  if (v.status === 'closed') return 'closed'
  // status === 'open'
  if (v.isPending) return 'pending'
  if (isPastDue(v.dueDate, today)) return 'late'
  return 'sent'
}

/**
 * Harvest "Late" (specs/27 AC-STAT-001/002): an open invoice whose due date is a calendar day
 * before `today` (the account's calendar day as a UTC-midnight date). The due day itself is not
 * late. Harvest shows Late even for a $0 balance, so the balance is not consulted.
 */
export function isPastDue(dueDate: Date | null, today: Date): boolean {
  if (!dueDate) return false
  const due = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate())
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return due < t
}

/**
 * Whole calendar days an invoice is past due as of `today` (the account's calendar day, UTC
 * midnight — lib/tz todayIn). 0 on or before the due day, 1 the day after; same boundary as
 * isPastDue. Used for A/R aging and the "N days past due" reminder copy.
 */
export function daysPastDue(dueDate: Date | null, today: Date): number {
  if (!dueDate) return 0
  const due = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate())
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Math.max(0, Math.round((t - due) / 86_400_000))
}
