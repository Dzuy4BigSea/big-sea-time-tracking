import { describe, it, expect } from 'vitest'
import { retainerBalanceCents, planDeposit, planDrawdown } from './retainer'

describe('retainer math', () => {
  it('balance = deposit − drawn', () => {
    expect(retainerBalanceCents({ depositCents: 1_000_000, drawnCents: 200_000 })).toBe(800_000)
  })

  it('AC-RET-001: applying $2,000 to a $10,000 deposit → drawn 200000, balance 800000', () => {
    const r = planDrawdown({ depositCents: 1_000_000, drawnCents: 0 }, 200_000)
    expect(r).toEqual({ drawnCents: 200_000, balanceCents: 800_000 })
  })

  it('deposits raise deposit and balance', () => {
    expect(planDeposit({ depositCents: 500_000, drawnCents: 100_000 }, 250_000)).toEqual({
      depositCents: 750_000,
      balanceCents: 650_000,
    })
  })

  it('AC-RET-003: overdraw rejected by default', () => {
    expect(() => planDrawdown({ depositCents: 100_000, drawnCents: 90_000 }, 20_000)).toThrow(/exceeds/)
  })

  it('AC-RET-003: overdraw allowed when allowNegative → negative balance', () => {
    const r = planDrawdown({ depositCents: 100_000, drawnCents: 90_000 }, 20_000, { allowNegative: true })
    expect(r).toEqual({ drawnCents: 110_000, balanceCents: -10_000 })
  })

  it('drawing exactly the balance is allowed (boundary)', () => {
    const r = planDrawdown({ depositCents: 100_000, drawnCents: 40_000 }, 60_000)
    expect(r).toEqual({ drawnCents: 100_000, balanceCents: 0 })
  })

  it('rejects non-positive / non-integer amounts', () => {
    expect(() => planDrawdown({ depositCents: 100_000, drawnCents: 0 }, 0)).toThrow()
    expect(() => planDeposit({ depositCents: 0, drawnCents: 0 }, -5)).toThrow()
    expect(() => planDrawdown({ depositCents: 100_000, drawnCents: 0 }, 12.5)).toThrow()
  })
})
