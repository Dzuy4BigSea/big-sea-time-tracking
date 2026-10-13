/**
 * Xero payload mappers (specs/14 §Xero). Pure + DB-free → unit-tested. The sync module
 * feeds these Track2 rows and posts the result to the Xero REST API.
 */

export interface XeroInvoiceInput {
  invoiceNumber: string | null
  reference: string | null
  currency: string
  issueDateYmd: string | null
  dueDateYmd: string | null
  contactId: string
  defaultRevenueAccountCode: string
  trackingName?: string | null // e.g. "Client"
  trackingOption?: string | null // e.g. the client name
  lineItems: { description: string; quantity: number; unitAmount: number; accountCode?: string | null }[]
  /**
   * 'NoTax' when tax is carried as explicit lines (buildXeroLines) so Xero adds none of its own and
   * the Xero total equals the Track2 total. Defaults to 'Exclusive' for backward compatibility.
   */
  lineAmountTypes?: 'Exclusive' | 'NoTax'
}

/** Build a Xero ACCREC invoice body. Amounts are in major units (dollars), as Xero expects. */
export function toXeroInvoice(input: XeroInvoiceInput): Record<string, unknown> {
  const line = (li: XeroInvoiceInput['lineItems'][number]) => {
    const l: Record<string, unknown> = {
      Description: li.description,
      Quantity: li.quantity,
      UnitAmount: Number(li.unitAmount.toFixed(2)),
      AccountCode: li.accountCode || input.defaultRevenueAccountCode,
    }
    if (input.trackingName && input.trackingOption) {
      l.Tracking = [{ Name: input.trackingName, Option: input.trackingOption }]
    }
    return l
  }
  const inv: Record<string, unknown> = {
    Type: 'ACCREC',
    Contact: { ContactID: input.contactId },
    CurrencyCode: input.currency,
    LineAmountTypes: input.lineAmountTypes ?? 'Exclusive',
    LineItems: input.lineItems.map(line),
    Status: 'AUTHORISED',
  }
  if (input.invoiceNumber) inv.InvoiceNumber = input.invoiceNumber
  if (input.reference) inv.Reference = input.reference
  if (input.issueDateYmd) inv.Date = input.issueDateYmd
  if (input.dueDateYmd) inv.DueDate = input.dueDateYmd
  return inv
}

export interface XeroPaymentInput {
  xeroInvoiceId: string
  accountCode: string
  amount: number // major units
  dateYmd: string
  reference?: string | null
}

export function toXeroPayment(input: XeroPaymentInput): Record<string, unknown> {
  const p: Record<string, unknown> = {
    Invoice: { InvoiceID: input.xeroInvoiceId },
    Account: { Code: input.accountCode },
    Amount: Number(input.amount.toFixed(2)),
    Date: input.dateYmd,
  }
  if (input.reference) p.Reference = input.reference
  return p
}

export const centsToMajor = (cents: number) => cents / 100

export interface Track2LineForXero {
  description: string
  quantity: number
  unitPriceCents: number
  amountCents: number
}

/**
 * Xero line items whose sum equals the Track2 invoice total (subtotal − discount + tax).
 *  - A line whose quantity × unit price (half-up) equals its stored amount is sent as-is; otherwise
 *    (legacy / imported rounding) it is sent as 1 × amount so Xero's line total matches ours.
 *  - The discount is a negative line; each tax is a positive line on `taxAccountCode` (falls back to
 *    the revenue account). Mapping tax rates to Xero TaxTypes is org-specific, so the invoice is
 *    sent with LineAmountTypes 'NoTax' and the tax as explicit lines.
 */
export function buildXeroLines(input: {
  lines: Track2LineForXero[]
  discountCents: number
  discountLabel?: string | null
  taxes: { name: string; cents: number }[]
  taxAccountCode?: string | null
}): XeroInvoiceInput['lineItems'] {
  const out: XeroInvoiceInput['lineItems'] = input.lines.map((li) => {
    const derived = Math.round(li.quantity * li.unitPriceCents)
    return derived === li.amountCents
      ? { description: li.description, quantity: li.quantity, unitAmount: centsToMajor(li.unitPriceCents) }
      : { description: li.description, quantity: 1, unitAmount: centsToMajor(li.amountCents) }
  })
  if (input.discountCents) {
    out.push({ description: input.discountLabel || 'Discount', quantity: 1, unitAmount: -centsToMajor(input.discountCents) })
  }
  for (const t of input.taxes) {
    if (t.cents) out.push({ description: t.name || 'Tax', quantity: 1, unitAmount: centsToMajor(t.cents), accountCode: input.taxAccountCode || null })
  }
  return out
}

/** Sum of Xero lines in cents, as Xero computes it (each line rounded to the cent). */
export function xeroLinesTotalCents(lines: XeroInvoiceInput['lineItems']): number {
  return lines.reduce((s, l) => s + Math.round(l.quantity * Math.round(l.unitAmount * 100)), 0)
}
