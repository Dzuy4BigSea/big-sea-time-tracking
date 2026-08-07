import { prisma } from '@/lib/prisma'
import { resolveBranding } from '@/modules/entities/resolveEntity'

export interface InvoiceAppearanceView {
  brandColor: string
  documentTitle: string
  showDocumentTitle: boolean
  logoFileUrl: string | null
  showItemTypeCol: boolean
  showDescriptionCol: boolean
  showQuantityCol: boolean
  showUnitPriceCol: boolean
  showAmountCol: boolean
}

// Matches the InvoiceAppearance schema defaults; used when an account has no row yet.
export const DEFAULT_APPEARANCE: InvoiceAppearanceView = {
  brandColor: '#004348',
  documentTitle: 'INVOICE',
  showDocumentTitle: true,
  logoFileUrl: null,
  showItemTypeCol: false,
  showDescriptionCol: true,
  showQuantityCol: false,
  showUnitPriceCol: false,
  showAmountCol: true,
}

/**
 * Overlay a business entity's branding (color / logo / title) on the account appearance (specs/16).
 * Blank entity fields fall through to the account default; column toggles stay account-level.
 */
export function applyEntityBranding(
  appearance: InvoiceAppearanceView,
  entity: { brandColor?: string | null; logoFileUrl?: string | null; documentTitle?: string | null } | null | undefined,
): InvoiceAppearanceView {
  const b = resolveBranding(entity, {
    brandColor: appearance.brandColor,
    logoFileUrl: appearance.logoFileUrl,
    documentTitle: appearance.documentTitle,
  })
  return { ...appearance, ...b }
}

export async function getInvoiceAppearance(accountId: string): Promise<InvoiceAppearanceView> {
  const row = await prisma.invoiceAppearance.findUnique({ where: { accountId } })
  if (!row) return DEFAULT_APPEARANCE
  return {
    brandColor: row.brandColor,
    documentTitle: row.documentTitle,
    showDocumentTitle: row.showDocumentTitle,
    logoFileUrl: row.logoFileUrl,
    showItemTypeCol: row.showItemTypeCol,
    showDescriptionCol: row.showDescriptionCol,
    showQuantityCol: row.showQuantityCol,
    showUnitPriceCol: row.showUnitPriceCol,
    showAmountCol: row.showAmountCol,
  }
}
