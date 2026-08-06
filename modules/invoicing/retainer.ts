/**
 * Retainer math (specs/10 §retainers).
 *
 * A retainer is a prepaid balance a client draws down: balance = deposit − drawn.
 * Deposits raise the balance; applying an invoice/amount draws it down. Pure + DB-free
 * so the rules are unit-tested; the service layer persists the returned figures.
 */

export interface RetainerState {
  depositCents: number
  drawnCents: number
}

export function retainerBalanceCents(state: RetainerState): number {
  return state.depositCents - state.drawnCents
}

/** Add a prepaid deposit. Returns the new deposit + balance. */
export function planDeposit(state: RetainerState, amountCents: number): { depositCents: number; balanceCents: number } {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RangeError('Deposit amount must be a positive whole number of cents.')
  }
  const depositCents = state.depositCents + amountCents
  return { depositCents, balanceCents: depositCents - state.drawnCents }
}

/**
 * Draw an amount down against the retainer (e.g. when applying an invoice).
 * Rejects an overdraw unless `allowNegative` (AC-RET-003; default reject).
 * Returns the new drawn + balance (AC-RET-001).
 */
export function planDrawdown(
  state: RetainerState,
  amountCents: number,
  opts: { allowNegative?: boolean } = {},
): { drawnCents: number; balanceCents: number } {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RangeError('Drawdown amount must be a positive whole number of cents.')
  }
  const balance = retainerBalanceCents(state)
  if (amountCents > balance && !opts.allowNegative) {
    throw new RangeError('Drawdown exceeds the remaining retainer balance.')
  }
  const drawnCents = state.drawnCents + amountCents
  return { drawnCents, balanceCents: state.depositCents - drawnCents }
}
