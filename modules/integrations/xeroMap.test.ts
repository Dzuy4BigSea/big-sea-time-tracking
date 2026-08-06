import { describe, it, expect } from 'vitest'
import { toXeroInvoice, toXeroPayment, centsToMajor } from './xeroMap'

describe('xero invoice mapper', () => {
  const base = {
    invoiceNumber: '1001',
    reference: 'Track2 1001',
    currency: 'USD',
    issueDateYmd: '2026-08-06',
    dueDateYmd: '2026-09-05',
    contactId: 'contact-1',
    defaultRevenueAccountCode: '400.2',
    lineItems: [{ description: 'Design', quantity: 10, unitAmount: 160 }],
  }

  it('builds an ACCREC invoice with the default revenue account', () => {
    const x = toXeroInvoice(base) as any
    expect(x.Type).toBe('ACCREC')
    expect(x.Contact.ContactID).toBe('contact-1')
    expect(x.InvoiceNumber).toBe('1001')
    expect(x.LineItems[0].AccountCode).toBe('400.2')
    expect(x.LineItems[0].UnitAmount).toBe(160)
  })

  it('per-line account code overrides the default', () => {
    const x = toXeroInvoice({ ...base, lineItems: [{ description: 'Hosting', quantity: 1, unitAmount: 50, accountCode: '400.23' }] }) as any
    expect(x.LineItems[0].AccountCode).toBe('400.23')
  })

  it('adds tracking when configured', () => {
    const x = toXeroInvoice({ ...base, trackingName: 'Client', trackingOption: 'Acme' }) as any
    expect(x.LineItems[0].Tracking).toEqual([{ Name: 'Client', Option: 'Acme' }])
  })

  it('omits tracking when not configured', () => {
    const x = toXeroInvoice(base) as any
    expect(x.LineItems[0].Tracking).toBeUndefined()
  })
})

describe('xero payment mapper', () => {
  it('maps invoice + account + amount', () => {
    const p = toXeroPayment({ xeroInvoiceId: 'xinv-1', accountCode: 'Stripe', amount: 525, dateYmd: '2026-08-06' }) as any
    expect(p.Invoice.InvoiceID).toBe('xinv-1')
    expect(p.Account.Code).toBe('Stripe')
    expect(p.Amount).toBe(525)
    expect(p.Date).toBe('2026-08-06')
  })
})

describe('centsToMajor', () => {
  it('converts cents to major units', () => {
    expect(centsToMajor(52500)).toBe(525)
  })
})
