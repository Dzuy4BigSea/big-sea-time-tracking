import type { PrismaClient } from '@prisma/client'
import { computeTotals } from '@/modules/invoicing/totals'

/**
 * Recompute and persist an invoice's stored money columns from its current line items + discount/tax
 * (specs/05). Called after any edit to line items or the discount/tax settings so the totals stay the
 * single source of truth. Uses computeTotals — the one reference for invoice financial correctness.
 */
export async function recomputeInvoiceTotals(prisma: PrismaClient, invoiceId: string): Promise<void> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      discountPercent: true,
      tax1Percent: true,
      tax2Percent: true,
      lineItems: { select: { amountCents: true, taxable: true } },
    },
  })
  if (!inv) return
  const t = computeTotals({
    lineItems: inv.lineItems,
    discountPercent: inv.discountPercent ? Number(inv.discountPercent) : null,
    tax1Percent: inv.tax1Percent ? Number(inv.tax1Percent) : null,
    tax2Percent: inv.tax2Percent ? Number(inv.tax2Percent) : null,
  })
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      subtotalCents: t.subtotalCents,
      discountCents: t.discountCents,
      taxCents: t.taxCents,
      totalCents: t.totalCents,
    },
  })
}
