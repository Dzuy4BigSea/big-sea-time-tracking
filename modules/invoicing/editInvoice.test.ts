import { describe, it, expect } from 'vitest'
import {
  parseQuantityHundredths,
  parsePriceCents,
  parsePercent,
  lineAmountFromHundredths,
  normalizeLines,
  diffLineItems,
  validateInvoiceNumberChange,
  dueDateFor,
  type StoredLine,
} from './editInvoice'
import { effectiveOnlineMethods } from './onlinePayments'

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('parsing (INV-1)', () => {
  it('quantity → hundredths, half-up, blank = 1', () => {
    expect(parseQuantityHundredths('2')).toBe(200)
    expect(parseQuantityHundredths('1.005')).toBe(101)
    expect(parseQuantityHundredths('0.333')).toBe(33)
    expect(parseQuantityHundredths('1,250.5')).toBe(125050)
    expect(parseQuantityHundredths('')).toBe(100)
    expect(parseQuantityHundredths('-1')).toBe(-100)
    expect(parseQuantityHundredths('abc')).toBeNull()
    expect(parseQuantityHundredths('1e3')).toBeNull()
  })
  it('price → cents, strips $ and commas, blank = 0', () => {
    expect(parsePriceCents('$1,500.00')).toBe(150000)
    expect(parsePriceCents('0.29')).toBe(29)
    expect(parsePriceCents('95')).toBe(9500)
    expect(parsePriceCents('-$10')).toBe(-1000)
    expect(parsePriceCents('')).toBe(0)
    expect(parsePriceCents('ten')).toBeNull()
  })
  it('percent: blank null, invalid undefined', () => {
    expect(parsePercent('')).toBeNull()
    expect(parsePercent('8.875')).toBe(8.875)
    expect(parsePercent('-1')).toBeUndefined()
    expect(parsePercent('x')).toBeUndefined()
  })
  it('amount = round(qty × price) half-up with exact integer math', () => {
    expect(lineAmountFromHundredths(150, 12000)).toBe(18000)
    expect(lineAmountFromHundredths(33, 15000)).toBe(4950)
    expect(lineAmountFromHundredths(150, 1)).toBe(2) // 1.5 → 2
    expect(lineAmountFromHundredths(29, 100)).toBe(29)
  })
})

describe('normalizeLines', () => {
  it('drops blank new rows, numbers sortOrder in submitted order, computes amounts', () => {
    const r = normalizeLines([
      { id: 'a', description: 'Design', quantity: '3', unitPrice: '120' },
      { id: null, description: '', quantity: '1', unitPrice: '' },
      { id: null, description: 'Hosting', quantity: '', unitPrice: '50.00', linkedProjectId: 'p1', itemTypeId: 'it1' },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toHaveLength(2)
    expect(r.value[0]).toMatchObject({ id: 'a', quantityHundredths: 300, unitPriceCents: 12000, amountCents: 36000, sortOrder: 0 })
    expect(r.value[1]).toMatchObject({ id: null, quantityHundredths: 100, amountCents: 5000, sortOrder: 1, linkedProjectId: 'p1', itemTypeId: 'it1' })
  })
  it('rejects a bad quantity or price with the line number', () => {
    const r = normalizeLines([{ description: 'x', quantity: 'two', unitPrice: '1' }])
    expect(r).toEqual({ ok: false, error: 'Line 1: quantity must be a number.' })
    const r2 = normalizeLines([{ description: 'x', quantity: '1', unitPrice: '1' }, { description: 'y', quantity: '1', unitPrice: '$$' }])
    expect(r2).toEqual({ ok: false, error: 'Line 2: unit price must be an amount.' })
  })
  it('rejects an amount beyond an Int cents column', () => {
    const r = normalizeLines([{ description: 'x', quantity: '100000', unitPrice: '100000' }])
    expect(r.ok).toBe(false)
  })
})

describe('diffLineItems', () => {
  const stored: StoredLine[] = [
    { id: 'a', itemTypeId: null, description: 'Design', quantityHundredths: 300, unitPriceCents: 12000, amountCents: 36000, linkedProjectId: 'p1', taxable: true, sortOrder: 0 },
    { id: 'b', itemTypeId: null, description: 'Dev', quantityHundredths: 400, unitPriceCents: 15000, amountCents: 60000, linkedProjectId: 'p1', taxable: true, sortOrder: 1 },
    { id: 'c', itemTypeId: null, description: 'Fee', quantityHundredths: 100, unitPriceCents: 500000, amountCents: 500000, linkedProjectId: 'ff', taxable: true, sortOrder: 2 },
  ]
  const norm = (rows: Parameters<typeof normalizeLines>[0]) => {
    const r = normalizeLines(rows)
    if (!r.ok) throw new Error(r.error)
    return r.value
  }

  it('unchanged rows produce an empty diff', () => {
    const r = diffLineItems(stored, norm([
      { id: 'a', description: 'Design', quantity: '3', unitPrice: '120', linkedProjectId: 'p1' },
      { id: 'b', description: 'Dev', quantity: '4', unitPrice: '150', linkedProjectId: 'p1' },
      { id: 'c', description: 'Fee', quantity: '1', unitPrice: '5000', linkedProjectId: 'ff' },
    ]))
    expect(r).toEqual({ ok: true, value: { added: [], updated: [], removed: [] } })
  })

  it('edit + add + remove + reorder', () => {
    const r = diffLineItems(stored, norm([
      { id: 'c', description: 'Fee', quantity: '1', unitPrice: '5000', linkedProjectId: 'ff' }, // moved to top
      { id: 'a', description: 'Design work', quantity: '3', unitPrice: '120', linkedProjectId: 'p1' }, // edited + moved
      { id: null, description: 'Hosting', quantity: '1', unitPrice: '50' },
    ]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.removed).toEqual(['b'])
    expect(r.value.added.map((l) => l.description)).toEqual(['Hosting'])
    expect(r.value.updated.map((l) => [l.id, l.sortOrder])).toEqual([['c', 0], ['a', 1]])
    // The fixed-fee line keeps its project link (fixedFee.ts counts linked lines).
    expect(r.value.updated[0].linkedProjectId).toBe('ff')
  })

  it('refuses an id that is not on this invoice, or a duplicated id', () => {
    expect(diffLineItems(stored, norm([{ id: 'zzz', description: 'x', quantity: '1', unitPrice: '1' }])).ok).toBe(false)
    expect(diffLineItems(stored, norm([
      { id: 'a', description: 'x', quantity: '1', unitPrice: '1' },
      { id: 'a', description: 'y', quantity: '1', unitPrice: '1' },
    ])).ok).toBe(false)
  })
})

describe('validateInvoiceNumberChange (INV-6)', () => {
  const base = { current: '1005', status: 'open', seq: 1010, takenByOther: false, retired: false }
  it('unchanged is a no-op', () => {
    expect(validateInvoiceNumberChange({ ...base, requested: ' 1005 ' })).toEqual({ ok: true, value: { number: '1005', changed: false, bumpSeqTo: null } })
  })
  it('an unnumbered draft may stay unnumbered', () => {
    expect(validateInvoiceNumberChange({ ...base, current: null, status: 'draft', requested: '' })).toEqual({
      ok: true,
      value: { number: null, changed: false, bumpSeqTo: null },
    })
  })
  it('an assigned number cannot be cleared', () => {
    expect(validateInvoiceNumberChange({ ...base, requested: '' })).toEqual({ ok: false, error: 'Invoice ID is required.' })
  })
  it('a higher numeric ID moves the sequence; a lower one does not', () => {
    expect(validateInvoiceNumberChange({ ...base, requested: '392700' })).toEqual({ ok: true, value: { number: '392700', changed: true, bumpSeqTo: 392700 } })
    expect(validateInvoiceNumberChange({ ...base, requested: '1001' })).toEqual({ ok: true, value: { number: '1001', changed: true, bumpSeqTo: null } })
    expect(validateInvoiceNumberChange({ ...base, requested: 'INV-77' })).toEqual({ ok: true, value: { number: 'INV-77', changed: true, bumpSeqTo: null } })
  })
  it('never reuses a number held by another invoice or a deleted one', () => {
    expect(validateInvoiceNumberChange({ ...base, requested: '1006', takenByOther: true }).ok).toBe(false)
    expect(validateInvoiceNumberChange({ ...base, requested: '1004', retired: true })).toEqual({
      ok: false,
      error: "Invoice ID 1004 was used by a deleted invoice and can't be reused.",
    })
  })
  it('rejects odd characters and overlong IDs', () => {
    expect(validateInvoiceNumberChange({ ...base, requested: 'a b' }).ok).toBe(false)
    expect(validateInvoiceNumberChange({ ...base, requested: 'x'.repeat(51) }).ok).toBe(false)
  })
})

describe('dueDateFor', () => {
  it('term days from the issue date; custom as typed; null without an issue date', () => {
    expect(dueDateFor('net_30', d('2026-09-01'), null)).toEqual(d('2026-10-01'))
    expect(dueDateFor('due_on_receipt', d('2026-09-01'), null)).toEqual(d('2026-09-01'))
    expect(dueDateFor('custom', d('2026-09-01'), d('2026-12-25'))).toEqual(d('2026-12-25'))
    expect(dueDateFor('net_15', null, null)).toBeNull()
  })
})

describe('effectiveOnlineMethods', () => {
  const all = { acceptOnlinePayments: true, allowCardPayments: true, allowAchPayments: true }
  it('the invoice narrows what the connection offers', () => {
    expect(effectiveOnlineMethods({ creditCardEnabled: true, achEnabled: true }, all)).toEqual({ card: true, ach: true })
    expect(effectiveOnlineMethods({ creditCardEnabled: true, achEnabled: true }, { ...all, allowCardPayments: false })).toEqual({ card: false, ach: true })
    expect(effectiveOnlineMethods({ creditCardEnabled: false, achEnabled: true }, { ...all, allowAchPayments: false })).toBeNull()
  })
  it('turned off for the invoice → not payable online', () => {
    expect(effectiveOnlineMethods({ creditCardEnabled: true }, { ...all, acceptOnlinePayments: false })).toBeNull()
  })
  it('a connection with no method set keeps the card fallback', () => {
    expect(effectiveOnlineMethods({}, all)).toEqual({ card: true, ach: false })
  })
})
