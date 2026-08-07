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

/**
 * Resolve the label set for an invoice. Fallback chain (spec 18): the invoice entity's overrides →
 * the account default (entityId null) → the built-in English defaults. Each level fills only the
 * keys it defines, so a company can override just "Invoice for" and inherit the rest.
 */
export async function getInvoiceLabels(accountId: string, entityId?: string | null): Promise<InvoiceLabelSet> {
  const rows = await prisma.invoiceLabels.findMany({
    where: { accountId, OR: [{ entityId: null }, ...(entityId ? [{ entityId }] : [])] },
  })
  const accountRow = rows.find((r) => r.entityId === null)
  const entityRow = entityId ? rows.find((r) => r.entityId === entityId) : undefined
  const accountLabels = (accountRow?.labels ?? {}) as Partial<InvoiceLabelSet>
  const entityLabels = (entityRow?.labels ?? {}) as Partial<InvoiceLabelSet>
  return { ...DEFAULT_LABELS, ...accountLabels, ...entityLabels }
}

/** Load a single level's raw stored map (for editors — no fallback merge). */
export async function getStoredLabels(accountId: string, entityId: string | null): Promise<Partial<InvoiceLabelSet>> {
  const row = await prisma.invoiceLabels.findFirst({ where: { accountId, entityId } })
  return (row?.labels ?? {}) as Partial<InvoiceLabelSet>
}
