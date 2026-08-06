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
    LineAmountTypes: 'Exclusive',
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
