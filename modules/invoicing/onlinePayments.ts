/**
 * Per-invoice online payment choice (Harvest "Accept online payments for this invoice" with
 * Credit Card / ACH; specs/05 §Editing an invoice). The Stripe connection says which methods the
 * company offers; the invoice can only narrow that set, never add to it.
 *
 * Pure: the public /i/[token] page and its Stripe checkout action both use it.
 */

export interface ConnectionMethods {
  creditCardEnabled?: unknown
  achEnabled?: unknown
}

export interface InvoiceOnlinePayment {
  acceptOnlinePayments: boolean
  allowCardPayments: boolean
  allowAchPayments: boolean
}

/**
 * The Stripe methods offered for this invoice, or null when it can't be paid online. Pass the
 * invoice `currency` to drop ACH for non-USD invoices (Stripe's us_bank_account is USD-only), so
 * the page never shows a Pay button the checkout can't honour.
 */
export function effectiveOnlineMethods(conn: ConnectionMethods, inv: InvoiceOnlinePayment & { currency?: string }): { card: boolean; ach: boolean } | null {
  if (!inv.acceptOnlinePayments) return null
  let connCard = !!conn.creditCardEnabled
  const connAch = !!conn.achEnabled
  // A connection with neither box ticked has always meant "card" (stripeClient's fallback).
  if (!connCard && !connAch) connCard = true
  const card = connCard && inv.allowCardPayments
  const ach = connAch && inv.allowAchPayments && (inv.currency === undefined || inv.currency.trim().toUpperCase() === 'USD')
  return card || ach ? { card, ach } : null
}
