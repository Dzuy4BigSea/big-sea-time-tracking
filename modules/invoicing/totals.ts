/**
 * Invoice totals — deterministic integer-cents math (specs/05-invoicing.md §Totals math).
 * Pure function; the single reference for invoice financial correctness.
 *
 * subtotal      = Σ line amounts
 * discount      = subtotal × discountPercent
 * taxable base  = Σ taxable line amounts, reduced by the discount when discountBeforeTax
 * tax1/tax2     = taxable base × percent (tax2 is on the base, not compounded)
 * total         = subtotal − discount + tax
 */
import { percentOf } from '../shared/money'

export interface TotalsLineItem {
  amountCents: number
  taxable: boolean
}

export interface TotalsInput {
  lineItems: TotalsLineItem[]
  discountPercent?: number | null
  tax1Percent?: number | null
  tax2Percent?: number | null
  /** When true (default), tax is computed on the taxable base AFTER discount. */
  discountBeforeTax?: boolean
}

export interface Totals {
  subtotalCents: number
  discountCents: number
  taxableBaseCents: number
  tax1Cents: number
  tax2Cents: number
  taxCents: number
  totalCents: number
}

export function computeTotals(input: TotalsInput): Totals {
  const { lineItems, discountPercent, tax1Percent, tax2Percent } = input
  const discountBeforeTax = input.discountBeforeTax ?? true

  const subtotalCents = lineItems.reduce((sum, li) => sum + li.amountCents, 0)
  const discountCents = discountPercent ? percentOf(subtotalCents, discountPercent) : 0

  const grossTaxableBase = lineItems.reduce((sum, li) => sum + (li.taxable ? li.amountCents : 0), 0)

  // Reduce the taxable base by the discount taken on its taxable portion.
  const taxableBaseCents =
    discountBeforeTax && discountPercent
      ? grossTaxableBase - percentOf(grossTaxableBase, discountPercent)
      : grossTaxableBase

  const tax1Cents = tax1Percent ? percentOf(taxableBaseCents, tax1Percent) : 0
  const tax2Cents = tax2Percent ? percentOf(taxableBaseCents, tax2Percent) : 0
  const taxCents = tax1Cents + tax2Cents

  const totalCents = subtotalCents - discountCents + taxCents

  return { subtotalCents, discountCents, taxableBaseCents, tax1Cents, tax2Cents, taxCents, totalCents }
}

/** Amount still owed on an invoice given payments recorded. */
export function dueCents(totalCents: number, paidCents: number): number {
  return totalCents - paidCents
}
