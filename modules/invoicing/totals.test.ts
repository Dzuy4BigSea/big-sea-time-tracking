import { describe, it, expect } from 'vitest'
import { computeTotals, dueCents } from './totals'

const line = (amountCents: number, taxable = true) => ({ amountCents, taxable })

describe('computeTotals', () => {
  it('AC-INV-001: sums line amounts into the subtotal', () => {
    const t = computeTotals({ lineItems: [line(36000), line(60000)] })
    expect(t.subtotalCents).toBe(96000)
    expect(t.totalCents).toBe(96000)
  })

  it('AC-INV-004: discount 10% + tax 8% with discountBeforeTax → tax on the discounted base', () => {
    const t = computeTotals({
      lineItems: [line(100000)], // $1000, taxable
      discountPercent: 10,
      tax1Percent: 8,
      discountBeforeTax: true,
    })
    expect(t.discountCents).toBe(10000) // $100
    expect(t.taxableBaseCents).toBe(90000) // $900
    expect(t.tax1Cents).toBe(7200) // 8% of $900 = $72
    expect(t.taxCents).toBe(7200)
    expect(t.totalCents).toBe(97200) // $972
  })

  it('discountBeforeTax=false taxes the full pre-discount base', () => {
    const t = computeTotals({
      lineItems: [line(100000)],
      discountPercent: 10,
      tax1Percent: 8,
      discountBeforeTax: false,
    })
    expect(t.taxableBaseCents).toBe(100000)
    expect(t.tax1Cents).toBe(8000) // 8% of $1000
    expect(t.totalCents).toBe(98000) // 100000 - 10000 + 8000
  })

  it('only taxable lines contribute to the taxable base', () => {
    const t = computeTotals({
      lineItems: [line(50000, true), line(50000, false)],
      tax1Percent: 10,
    })
    expect(t.subtotalCents).toBe(100000)
    expect(t.taxableBaseCents).toBe(50000)
    expect(t.tax1Cents).toBe(5000)
    expect(t.totalCents).toBe(105000)
  })

  it('tax2 is applied to the base, not compounded on tax1', () => {
    const t = computeTotals({ lineItems: [line(100000)], tax1Percent: 8, tax2Percent: 2 })
    expect(t.tax1Cents).toBe(8000)
    expect(t.tax2Cents).toBe(2000)
    expect(t.taxCents).toBe(10000)
    expect(t.totalCents).toBe(110000)
  })

  it('handles no discount / no tax', () => {
    const t = computeTotals({ lineItems: [line(12345)] })
    expect(t.discountCents).toBe(0)
    expect(t.taxCents).toBe(0)
    expect(t.totalCents).toBe(12345)
  })
})

describe('dueCents', () => {
  it('AC-INV-008: due = total − paid', () => {
    expect(dueCents(97200, 50000)).toBe(47200)
    expect(dueCents(97200, 97200)).toBe(0)
  })
})
