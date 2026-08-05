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
  written_off: new Set(),
  closed: new Set(),
}

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
      // Reverts to draft, releases reserved entries, but keeps the already-assigned number.
      return { status: 'draft', paidCents: state.paidCents, effects: { releaseEntries: true, retainNumber: true } }

    case 'write_off':
      return { status: 'written_off', paidCents: state.paidCents, effects: {} }

    case 'close':
      return { status: 'closed', paidCents: state.paidCents, effects: {} }

    case 'delete':
      // Allowed from draft AND sent (observed). Releases entries back to the pool.
      return { status: state.status, paidCents: state.paidCents, effects: { deleteInvoice: true, releaseEntries: true } }
  }
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
  const due = v.totalCents - v.paidCents
  if (v.dueDate != null && due > 0 && today.getTime() > v.dueDate.getTime()) return 'late'
  return 'sent'
}
