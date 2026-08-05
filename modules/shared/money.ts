/**
 * Money helpers. All amounts are integer minor units (cents). No floats. See INV-1.
 * Rounding is half-up (ties toward +infinity), matching the spec's "ties round up".
 */

/** Round to the nearest integer, ties up. */
export function roundHalfUp(value: number): number {
  // JS Math.round rounds .5 toward +infinity, which is our half-up rule.
  return Math.round(value)
}

/** `percent` of a cents amount, rounded half-up to whole cents. e.g. percentOf(100000, 8) => 8000. */
export function percentOf(baseCents: number, percent: number): number {
  return roundHalfUp((baseCents * percent) / 100)
}

/** Multiply a decimal quantity by a unit price (cents), rounded half-up. */
export function lineAmountCents(quantity: number, unitPriceCents: number): number {
  return roundHalfUp(quantity * unitPriceCents)
}
