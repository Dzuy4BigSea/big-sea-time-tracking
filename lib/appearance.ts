import { prisma } from '@/lib/prisma'

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
