import { describe, it, expect } from 'vitest'
import { toXeroInvoice, toXeroPayment, centsToMajor, buildXeroLines, xeroLinesTotalCents, taxLinesFor, paymentReference, majorToCents } from './xeroMap'

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

describe('xero lines carry discount + tax so totals match', () => {
  it('sum of Xero lines equals subtotal − discount + tax', () => {
    // 0.33h × $150 = $49.50, 10 × $160 = $1,600 → subtotal 164950; 10% discount 16495; tax 11876
    const lines = buildXeroLines({
      lines: [
        { description: 'Design', quantity: 0.33, unitPriceCents: 15000, amountCents: 4950 },
        { description: 'Dev', quantity: 10, unitPriceCents: 16000, amountCents: 160000 },
      ],
      discountCents: 16495,
      discountLabel: 'Discount (10%)',
      taxes: [{ name: 'Sales tax (8%)', cents: 11876 }],
      taxAccountCode: '820',
    })
    expect(lines).toHaveLength(4)
    expect(lines[2]).toMatchObject({ description: 'Discount (10%)', quantity: 1, unitAmount: -164.95 })
    expect(lines[3]).toMatchObject({ unitAmount: 118.76, accountCode: '820' })
    expect(xeroLinesTotalCents(lines)).toBe(164950 - 16495 + 11876)
    const x = toXeroInvoice({
      invoiceNumber: '1',
      reference: null,
      currency: 'USD',
      issueDateYmd: null,
      dueDateYmd: null,
      contactId: 'c',
      defaultRevenueAccountCode: '400',
      lineItems: lines,
      lineAmountTypes: 'NoTax',
    }) as any
    expect(x.LineAmountTypes).toBe('NoTax')
    expect(x.LineItems[3].AccountCode).toBe('820')
    expect(x.LineItems[0].AccountCode).toBe('400')
  })

  it('a legacy line whose qty × price ≠ amount is sent as 1 × amount', () => {
    const lines = buildXeroLines({
      lines: [{ description: 'Old', quantity: 0.33, unitPriceCents: 15000, amountCents: 5000 }],
      discountCents: 0,
      taxes: [],
    })
    expect(lines[0]).toMatchObject({ quantity: 1, unitAmount: 50 })
    expect(xeroLinesTotalCents(lines)).toBe(5000)
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

describe('taxLinesFor', () => {
  const base = { tax1Name: 'Sales tax', tax2Name: 'City', discountPercent: null, lineItems: [{ amountCents: 10000, taxable: true }, { amountCents: 5000, taxable: false }] }
  it('splits into named taxes when recomputation reproduces the stored tax', () => {
    expect(taxLinesFor({ ...base, taxCents: 1200, tax1Percent: 8, tax2Percent: 4 })).toEqual([
      { name: 'Sales tax (8%)', cents: 800 },
      { name: 'City (4%)', cents: 400 },
    ])
  })
  it('falls back to one line carrying the stored tax (legacy rounding) so totals still match', () => {
    expect(taxLinesFor({ ...base, taxCents: 1201, tax1Percent: 8, tax2Percent: 4 })).toEqual([{ name: 'Sales tax', cents: 1201 }])
  })
  it('no tax → no lines', () => {
    expect(taxLinesFor({ ...base, taxCents: 0, tax1Percent: null, tax2Percent: null })).toEqual([])
  })
})

describe('payment reference marker', () => {
  it('always carries T2:<paymentId> and stays within 255 chars', () => {
    expect(paymentReference('pay_1', 'Paid online via Stripe')).toBe('Paid online via Stripe · T2:pay_1')
    expect(paymentReference('pay_1', null)).toBe('Track2 payment T2:pay_1')
    const long = paymentReference('pay_1', 'x'.repeat(400))
    expect(long.length).toBeLessThanOrEqual(255)
    expect(long).toContain('T2:pay_1')
  })
  it('majorToCents rounds Xero floats', () => {
    expect(majorToCents(1649.5)).toBe(164950)
    expect(majorToCents(0.1 + 0.2)).toBe(30)
  })
})
