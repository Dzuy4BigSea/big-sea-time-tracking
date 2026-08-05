/**
 * Uninvoiced pool (specs/05-invoicing.md §Uninvoiced pool).
 *
 * A billable item is "uninvoiced" — available to be pulled onto an invoice — iff it is
 * billable, not already on a line item, and not locked as invoiced. Adding to an invoice
 * sets invoiceLineItemId (removing it from the pool); this predicate is the single
 * definition used by both invoice creation and the uninvoiced report so the two never
 * diverge. Guards INV-4 (no item on two non-void invoices).
 */

export interface InvoiceableItem {
  isBillable: boolean
  invoiceLineItemId: string | null
  /** time entries: 'open' | 'approved' | 'invoiced'; expenses: 'open' | 'invoiced'. */
  lockState: string
}

export function isUninvoiced(item: InvoiceableItem): boolean {
  return item.isBillable && item.invoiceLineItemId == null && item.lockState !== 'invoiced'
}

/** Filter a set of items down to those eligible to be pulled onto an invoice. */
export function invoiceablePool<T extends InvoiceableItem>(items: T[]): T[] {
  return items.filter(isUninvoiced)
}
