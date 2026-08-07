import 'server-only'
import { prisma } from '@/lib/prisma'
import { getConnectionWithSecrets, logSync } from '@/lib/integrations'
import { entityIdForInvoice } from '@/lib/entities'
import { toXeroInvoice, toXeroPayment, centsToMajor } from '@/modules/integrations/xeroMap'

const XERO_API = 'https://api.xero.com/api.xro/2.0'
const ymd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null)

async function xeroFetch(
  accessToken: string,
  tenantId: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const res = await fetch(`${XERO_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'xero-tenant-id': tenantId,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`Xero ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

/**
 * Copy a Track2 invoice to Xero as an ACCREC invoice (specs/14, AC-XERO-001/002/003/005).
 * No-op (returns null) when Xero is not connected. Idempotent: updates when xeroInvoiceId is set.
 */
export async function copyInvoiceToXero(accountId: string, invoiceId: string): Promise<string | null> {
  // Route to the invoice's business entity's Xero organisation (specs/16); falls back to shared.
  const entityId = await entityIdForInvoice(accountId, invoiceId)
  const conn = await getConnectionWithSecrets(accountId, 'xero', entityId)
  const accessToken = conn?.secrets.accessToken
  const tenantId = String(conn?.config.tenantId ?? '')
  if (!conn || conn.status !== 'connected' || !accessToken || !tenantId) return null

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId },
    include: { client: true, lineItems: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!invoice) return null

  try {
    // Ensure the client exists as a Xero contact.
    let contactId = invoice.client.xeroContactId
    if (!contactId) {
      const cRes = await xeroFetch(accessToken, tenantId, 'POST', '/Contacts', { Contacts: [{ Name: invoice.client.name }] })
      contactId = cRes?.Contacts?.[0]?.ContactID ?? null
      if (contactId) await prisma.client.update({ where: { id: invoice.client.id }, data: { xeroContactId: contactId } })
    }
    if (!contactId) throw new Error('Could not resolve Xero contact')

    const payload = toXeroInvoice({
      invoiceNumber: invoice.number,
      reference: invoice.number ? `Track2 ${invoice.number}` : null,
      currency: invoice.currency,
      issueDateYmd: ymd(invoice.issueDate),
      dueDateYmd: ymd(invoice.dueDate),
      contactId,
      defaultRevenueAccountCode: String(conn.config.defaultRevenueAccountCode ?? ''),
      trackingName: conn.config.populateTrackingByClient ? 'Client' : null,
      trackingOption: conn.config.populateTrackingByClient ? invoice.client.name : null,
      lineItems: invoice.lineItems.map((li) => ({
        description: li.description,
        quantity: Number(li.quantity),
        unitAmount: centsToMajor(li.unitPriceCents),
      })),
    })
    // Preserve the Xero id on update (idempotent).
    if (invoice.xeroInvoiceId) (payload as Record<string, unknown>).InvoiceID = invoice.xeroInvoiceId

    const res = await xeroFetch(accessToken, tenantId, 'POST', '/Invoices', { Invoices: [payload] })
    const xeroInvoiceId = res?.Invoices?.[0]?.InvoiceID ?? invoice.xeroInvoiceId
    if (xeroInvoiceId && xeroInvoiceId !== invoice.xeroInvoiceId) {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { xeroInvoiceId } })
    }
    await logSync({ accountId, provider: 'xero', direction: 'outbound', entityType: 'invoice', entityId: invoice.id, externalId: xeroInvoiceId, ok: true })
    return xeroInvoiceId ?? null
  } catch (e) {
    await logSync({ accountId, provider: 'xero', direction: 'outbound', entityType: 'invoice', entityId: invoice.id, ok: false, message: (e as Error).message?.slice(0, 200) })
    return null
  }
}

/**
 * Copy the invoice's latest un-synced payment to Xero against the configured payment account
 * (specs/14, AC-XERO-004). No-op when Xero disconnected or "do not copy payments" (no account).
 */
export async function copyPaymentToXero(accountId: string, invoiceId: string): Promise<void> {
  const entityId = await entityIdForInvoice(accountId, invoiceId)
  const conn = await getConnectionWithSecrets(accountId, 'xero', entityId)
  const accessToken = conn?.secrets.accessToken
  const tenantId = String(conn?.config.tenantId ?? '')
  const accountCode = String(conn?.config.paymentAccountCode ?? '')
  if (!conn || conn.status !== 'connected' || !accessToken || !tenantId || !accountCode) return

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId },
    select: { id: true, xeroInvoiceId: true, payments: { where: { xeroPaymentId: null }, orderBy: { createdAt: 'desc' }, take: 1 } },
  })
  if (!invoice) return
  // Invoice must exist in Xero first.
  const xeroInvoiceId = invoice.xeroInvoiceId ?? (await copyInvoiceToXero(accountId, invoiceId))
  if (!xeroInvoiceId) return
  const payment = invoice.payments[0]
  if (!payment) return

  try {
    const body = toXeroPayment({
      xeroInvoiceId,
      accountCode,
      amount: centsToMajor(payment.amountCents),
      dateYmd: payment.paidOn.toISOString().slice(0, 10),
      reference: payment.note,
    })
    const res = await xeroFetch(accessToken, tenantId, 'PUT', '/Payments', { Payments: [body] })
    const xeroPaymentId = res?.Payments?.[0]?.PaymentID ?? null
    if (xeroPaymentId) await prisma.payment.update({ where: { id: payment.id }, data: { xeroPaymentId } })
    await logSync({ accountId, provider: 'xero', direction: 'outbound', entityType: 'payment', entityId: invoice.id, externalId: xeroPaymentId, ok: true })
  } catch (e) {
    await logSync({ accountId, provider: 'xero', direction: 'outbound', entityType: 'payment', entityId: invoice.id, ok: false, message: (e as Error).message?.slice(0, 200) })
  }
}
