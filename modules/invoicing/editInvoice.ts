/**
 * Harvest-style "Edit invoice" rules (specs/05 §Editing an invoice). Pure functions shared by the
 * editor (live client-side totals) and the save action (authoritative re-validation).
 *
 * - Money is integer cents (INV-1). Quantity is held as integer hundredths (Decimal(12,2) in the DB)
 *   and a line amount is round(qty × unit price) half-up, computed from the hundredths so float noise
 *   (0.29 × 100 = 28.999…) can never move a cent.
 * - Line diffing: what the submitted rows add, update and remove relative to the stored lines. A
 *   removed line that carried tracked time / expenses must release them (INV-4); the caller does that
 *   in the same transaction.
 * - Invoice ID changes: unique per account, never a number already used (another invoice, or a
 *   deleted / renumbered one — INV-6), and a numeric ID above the sequence moves the sequence so
 *   the next invoice follows it (Harvest: "the next invoice will follow the new sequence").
 */
import { roundHalfUp } from '../shared/money'

/** Largest value an Int cents column holds. */
const MAX_CENTS = 2_147_483_647

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

const NUMERIC = /^[-+]?(\d+\.?\d*|\.\d+)$/

/** "1,234.5" / "$12" / " 3 " → a finite number, or null when it is not a plain number. */
function parsePlain(raw: string, stripCurrency: boolean): number | null {
  let s = String(raw ?? '').replace(/[,\s]/g, '')
  if (stripCurrency) s = s.replace(/^([-+]?)\$/, '$1')
  if (!NUMERIC.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** A decimal string scaled by 100 and rounded half-up to an integer (2 decimal places). */
function toHundredths(n: number): number {
  // toPrecision trims binary noise (1.005 * 100 = 100.49999…) before rounding.
  return roundHalfUp(Number((n * 100).toPrecision(12)))
}

/** Quantity → integer hundredths (2 decimals, half-up). Blank → 1 (Harvest's default). */
export function parseQuantityHundredths(raw: string): number | null {
  if (String(raw ?? '').trim() === '') return 100
  const n = parsePlain(raw, false)
  return n == null ? null : toHundredths(n)
}

/** Unit price ("1,500.00", "$95") → integer cents, half-up. Blank → 0. */
export function parsePriceCents(raw: string): number | null {
  if (String(raw ?? '').trim() === '') return 0
  const n = parsePlain(raw, true)
  return n == null ? null : toHundredths(n)
}

/** Percent field ("10", "8.875") → number ≥ 0, or null when blank. Undefined when invalid. */
export function parsePercent(raw: string): number | null | undefined {
  const s = String(raw ?? '').replace(/[%\s]/g, '')
  if (s === '') return null
  const n = parsePlain(s, false)
  if (n == null || n < 0 || n > 100) return undefined
  return n
}

/** Line amount in cents for `qtyHundredths` × `unitPriceCents`, half-up (integer math, exact). */
export function lineAmountFromHundredths(qtyHundredths: number, unitPriceCents: number): number {
  return roundHalfUp((qtyHundredths * unitPriceCents) / 100)
}

/** Display a stored quantity: up to 2 decimals, no trailing zeros ("2", "1.5", "0.33"). */
export function formatQuantity(qtyHundredths: number): string {
  return String(qtyHundredths / 100)
}

// ---------------------------------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------------------------------

/** One editor row as submitted (strings straight from the inputs). */
export interface SubmittedLine {
  /** the stored line id, or null/empty for a row added in the editor */
  id?: string | null
  itemTypeId?: string | null
  description: string
  quantity: string
  unitPrice: string
  linkedProjectId?: string | null
  taxable?: boolean
}

export interface NormalizedLine {
  id: string | null
  itemTypeId: string | null
  description: string
  quantityHundredths: number
  unitPriceCents: number
  amountCents: number
  linkedProjectId: string | null
  taxable: boolean
  /** position in the submitted order (0-based); becomes sortOrder */
  sortOrder: number
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/** A row the user left completely empty (Harvest drops these on save). */
export function isBlankRow(l: SubmittedLine): boolean {
  const price = String(l.unitPrice ?? '').trim()
  return !l.id && String(l.description ?? '').trim() === '' && (price === '' || parsePriceCents(price) === 0)
}

/** Validate + normalize the submitted rows (in display order). Blank new rows are dropped. */
export function normalizeLines(rows: SubmittedLine[]): Result<NormalizedLine[]> {
  const out: NormalizedLine[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (isBlankRow(r)) continue
    const n = i + 1
    const description = String(r.description ?? '').trim()
    if (description.length > 5000) return { ok: false, error: `Line ${n}: the description is too long.` }
    const q = parseQuantityHundredths(r.quantity)
    if (q == null) return { ok: false, error: `Line ${n}: quantity must be a number.` }
    const p = parsePriceCents(r.unitPrice)
    if (p == null) return { ok: false, error: `Line ${n}: unit price must be an amount.` }
    if (Math.abs(q) > 999_999_999_99) return { ok: false, error: `Line ${n}: quantity is too large.` }
    const amountCents = lineAmountFromHundredths(q, p)
    if (Math.abs(p) > MAX_CENTS || Math.abs(amountCents) > MAX_CENTS) return { ok: false, error: `Line ${n}: amount is too large.` }
    out.push({
      id: r.id ? String(r.id) : null,
      itemTypeId: r.itemTypeId ? String(r.itemTypeId) : null,
      description,
      quantityHundredths: q,
      unitPriceCents: p,
      amountCents,
      linkedProjectId: r.linkedProjectId ? String(r.linkedProjectId) : null,
      taxable: r.taxable ?? true,
      sortOrder: out.length,
    })
  }
  return { ok: true, value: out }
}

export interface StoredLine {
  id: string
  itemTypeId: string | null
  description: string
  quantityHundredths: number
  unitPriceCents: number
  amountCents: number
  linkedProjectId: string | null
  taxable: boolean
  sortOrder: number
}

export interface LineDiff {
  added: NormalizedLine[]
  /** retained lines whose content or position changed */
  updated: (NormalizedLine & { id: string })[]
  /** stored line ids no longer present */
  removed: string[]
}

const sameLine = (a: StoredLine, b: NormalizedLine) =>
  a.itemTypeId === b.itemTypeId &&
  a.description === b.description &&
  a.quantityHundredths === b.quantityHundredths &&
  a.unitPriceCents === b.unitPriceCents &&
  a.amountCents === b.amountCents &&
  a.linkedProjectId === b.linkedProjectId &&
  a.taxable === b.taxable &&
  a.sortOrder === b.sortOrder

/**
 * Diff the submitted rows against the stored lines. A submitted id that is not one of this
 * invoice's lines (or appears twice) is refused — never trust ids from the form.
 */
export function diffLineItems(stored: StoredLine[], next: NormalizedLine[]): Result<LineDiff> {
  const byId = new Map(stored.map((s) => [s.id, s]))
  const seen = new Set<string>()
  const added: NormalizedLine[] = []
  const updated: (NormalizedLine & { id: string })[] = []
  for (const l of next) {
    if (!l.id) {
      added.push(l)
      continue
    }
    const s = byId.get(l.id)
    if (!s || seen.has(l.id)) return { ok: false, error: 'A line item no longer exists on this invoice — reload and try again.' }
    seen.add(l.id)
    if (!sameLine(s, l)) updated.push({ ...l, id: l.id })
  }
  const removed = stored.filter((s) => !seen.has(s.id)).map((s) => s.id)
  return { ok: true, value: { added, updated, removed } }
}

// ---------------------------------------------------------------------------------------------
// Invoice ID (number)
// ---------------------------------------------------------------------------------------------

const INVOICE_ID = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/

export interface NumberChangeInput {
  current: string | null
  requested: string
  status: string
  /** Account.invoiceNumberSeq (the last number issued) */
  seq: number
  /** another invoice in the account already has `requested` */
  takenByOther: boolean
  /** `requested` was used by a deleted or renumbered invoice */
  retired: boolean
}

export interface NumberChange {
  number: string | null
  changed: boolean
  /** move Account.invoiceNumberSeq up to this value (numeric IDs above the sequence only) */
  bumpSeqTo: number | null
}

export function validateInvoiceNumberChange(i: NumberChangeInput): Result<NumberChange> {
  const requested = String(i.requested ?? '').trim()
  if (requested === (i.current ?? '')) return { ok: true, value: { number: i.current, changed: false, bumpSeqTo: null } }
  if (requested === '') {
    // A draft that has never had a number may stay unnumbered (one is assigned on send). Once a
    // number is assigned it is kept, so it can never be freed for reuse (INV-6).
    return { ok: false, error: 'Invoice ID is required.' }
  }
  if (requested.length > 50) return { ok: false, error: 'Invoice ID must be 50 characters or fewer.' }
  if (!INVOICE_ID.test(requested)) return { ok: false, error: 'Invoice ID may only use letters, numbers, and . _ - /' }
  if (i.takenByOther) return { ok: false, error: `Invoice ID ${requested} is already used by another invoice.` }
  if (i.retired) return { ok: false, error: `Invoice ID ${requested} was used before (by a deleted or renumbered invoice) and can't be reused.` }
  let bumpSeqTo: number | null = null
  if (/^\d+$/.test(requested)) {
    const n = Number(requested)
    if (Number.isSafeInteger(n) && n <= 2_147_483_647 && n > i.seq) bumpSeqTo = n
  }
  return { ok: true, value: { number: requested, changed: true, bumpSeqTo } }
}

// ---------------------------------------------------------------------------------------------
// Due date
// ---------------------------------------------------------------------------------------------

export const TERM_DAYS: Record<string, number> = {
  due_on_receipt: 0,
  net_15: 15,
  net_30: 30,
  net_45: 45,
  net_60: 60,
}

/** Editor "Due Date" options, in Harvest's order. */
export const DUE_OPTIONS = [
  { value: 'due_on_receipt', label: 'Upon receipt' },
  { value: 'net_15', label: 'Net 15' },
  { value: 'net_30', label: 'Net 30' },
  { value: 'net_45', label: 'Net 45' },
  { value: 'net_60', label: 'Net 60' },
  { value: 'custom', label: 'Custom' },
] as const

/**
 * The due date the editor stores: a custom date as typed, otherwise issue date + term (null when
 * there is no issue date yet — send fills both in).
 */
export function dueDateFor(term: string, issueDate: Date | null, customDue: Date | null): Date | null {
  if (term === 'custom') return customDue
  if (!issueDate) return null
  const days = TERM_DAYS[term] ?? 30
  return new Date(Date.UTC(issueDate.getUTCFullYear(), issueDate.getUTCMonth(), issueDate.getUTCDate() + days))
}
