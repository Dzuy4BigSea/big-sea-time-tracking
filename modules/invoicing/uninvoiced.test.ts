import { describe, it, expect } from 'vitest'
import { isUninvoiced, invoiceablePool } from './uninvoiced'

describe('isUninvoiced', () => {
  it('AC-INV-014 / AC-RPT-008: billable, unlinked, not-invoiced items are in the pool', () => {
    expect(isUninvoiced({ isBillable: true, invoiceLineItemId: null, lockState: 'open' })).toBe(true)
    expect(isUninvoiced({ isBillable: true, invoiceLineItemId: null, lockState: 'approved' })).toBe(true)
  })

  it('excludes non-billable, already-linked, or invoiced-locked items', () => {
    expect(isUninvoiced({ isBillable: false, invoiceLineItemId: null, lockState: 'open' })).toBe(false)
    expect(isUninvoiced({ isBillable: true, invoiceLineItemId: 'li_1', lockState: 'open' })).toBe(false)
    expect(isUninvoiced({ isBillable: true, invoiceLineItemId: null, lockState: 'invoiced' })).toBe(false)
  })
})

describe('invoiceablePool', () => {
  it('filters a mixed set down to the eligible items', () => {
    const items = [
      { id: 'a', isBillable: true, invoiceLineItemId: null, lockState: 'open' },
      { id: 'b', isBillable: false, invoiceLineItemId: null, lockState: 'open' },
      { id: 'c', isBillable: true, invoiceLineItemId: 'li_1', lockState: 'invoiced' },
      { id: 'd', isBillable: true, invoiceLineItemId: null, lockState: 'approved' },
    ]
    expect(invoiceablePool(items).map((i) => i.id)).toEqual(['a', 'd'])
  })
})
