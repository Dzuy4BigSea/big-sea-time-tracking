import { prisma } from '@/lib/prisma'

/**
 * Renameable invoice field labels (Harvest "Configure → Field labels"). Stored as a JSON
 * map on `InvoiceLabels.labels`; any missing key falls back to the English default here, so
 * the renderer can always read a complete set.
 */
export interface InvoiceLabelSet {
  from: string
  for: string
  invoiceId: string
  issueDate: string
  dueDate: string
  poNumber: string
  subject: string
  subtotal: string
  discount: string
  tax: string
  total: string
  paid: string
  amountDue: string
  notes: string
}

export const DEFAULT_LABELS: InvoiceLabelSet = {
  from: 'from',
  for: 'Invoice for',
  invoiceId: 'Invoice ID',
  issueDate: 'Issue date',
  dueDate: 'Due date',
  poNumber: 'PO number',
  subject: 'Subject',
  subtotal: 'Subtotal',
  discount: 'Discount',
  tax: 'Tax',
  total: 'Total',
  paid: 'Paid',
  amountDue: 'Amount due',
  notes: 'Notes',
}

/** Human-friendly section labels for the editor UI. */
export const LABEL_FIELDS: { key: keyof InvoiceLabelSet; hint: string }[] = [
  { key: 'from', hint: 'e.g. "Invoice N from"' },
  { key: 'for', hint: 'Recipient block heading' },
  { key: 'invoiceId', hint: 'Invoice number row' },
  { key: 'issueDate', hint: '' },
  { key: 'dueDate', hint: '' },
  { key: 'poNumber', hint: '' },
  { key: 'subject', hint: '' },
  { key: 'subtotal', hint: '' },
  { key: 'discount', hint: '' },
  { key: 'tax', hint: '' },
  { key: 'total', hint: '' },
  { key: 'paid', hint: '' },
  { key: 'amountDue', hint: 'The headline balance' },
  { key: 'notes', hint: '' },
]

export async function getInvoiceLabels(accountId: string): Promise<InvoiceLabelSet> {
  const row = await prisma.invoiceLabels.findUnique({ where: { accountId } })
  const stored = (row?.labels ?? {}) as Partial<InvoiceLabelSet>
  return { ...DEFAULT_LABELS, ...stored }
}
