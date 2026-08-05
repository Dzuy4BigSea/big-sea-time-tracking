import { describe, it, expect } from 'vitest'
import { roundHalfUp, percentOf, lineAmountCents } from './money'

describe('roundHalfUp', () => {
  it('rounds ties up', () => {
    expect(roundHalfUp(0.5)).toBe(1)
    expect(roundHalfUp(2.5)).toBe(3)
    expect(roundHalfUp(2.4)).toBe(2)
  })
})

describe('percentOf', () => {
  it('computes whole-cent percentages', () => {
    expect(percentOf(100000, 8)).toBe(8000) // 8% of $1000 = $80
    expect(percentOf(90000, 8)).toBe(7200) // 8% of $900  = $72
    expect(percentOf(100000, 10)).toBe(10000) // 10% of $1000 = $100
  })
})

describe('lineAmountCents', () => {
  it('multiplies quantity by unit price, rounded to cents', () => {
    expect(lineAmountCents(1.5, 15000)).toBe(22500) // 1.5h @ $150
    expect(lineAmountCents(2, 15000)).toBe(30000)
    expect(lineAmountCents(0.333, 15000)).toBe(4995)
  })
})
