/**
 * Apply a Harvest-style invoice edit (specs/05 §Editing an invoice): header fields, Invoice ID,
 * online-payment choice and every line item (add / edit / remove / reorder), atomically.
 *
 * The caller (app/invoices/[id]/edit/actions.ts) has already checked manage_invoices; this function
 * re-validates everything else and scopes every read/write to `accountId` (INV-5).
 * - Draft and open invoices only; paid, written-off and closed invoices stay read-only.
 * - Removing a line releases its tracked time / expenses back to the uninvoiced pool in the same
 *   transaction (INV-4), exactly as deleting the invoice would.
 * - Totals are recomputed by recomputeInvoiceTotals, which refuses a total below what has been paid
 *   and re-derives open ↔ paid — the only status change an edit can cause (INV-7).
 * - Invoice ID changes follow validateInvoiceNumberChange (INV-6); a higher numeric ID moves
 *   Account.invoiceNumberSeq under the same row lock allocateInvoiceNumber takes.
 */
import { Prisma, type PrismaClient, type PaymentTerm } from '@prisma/client'
import { recomputeInvoiceTotals } from './recomputeTotals'
import { transitionErrorMessage } from './invoiceState'
import { normalizeLines, diffLineItems, validateInvoiceNumberChange, dueDateFor, parsePercent, type SubmittedLine } from './editInvoice'
import { parseYmd } from '@/lib/week'

/** Same list as the client form (app/clients/actions.ts). */
export const INVOICE_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD']
const TERMS: PaymentTerm[] = ['due_on_receipt', 'net_15', 'net_30', 'net_45', 'net_60', 'custom']

export interface InvoiceEditInput {
  number: string
  subject: string
  poNumber: string
  notes: string
  issueDate: string // ymd or ''
  paymentTerm: string
  dueDate: string // ymd or '' (custom term only)
  discountPercent: string
  tax1Name: string
  tax1Percent: string
  tax2Name: string
  tax2Percent: string
  currency: string
  acceptOnlinePayments: boolean
  allowCardPayments: boolean
  allowAchPayments: boolean
  lines: SubmittedLine[]
}

export type SaveInvoiceEditResult =
  | {
      ok: true
      /** e.g. "Invoice updated (1 line added, 2 lines changed)" */
      summary: string
      renumbered: { from: string | null; to: string } | null
      releasedLineItemIds: string[]
    }
  | { ok: false; error: string }

class EditError extends Error {}
const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** Was `number` ever used by an invoice that has since been deleted or renumbered? (INV-6) */
export async function invoiceNumberRetired(prisma: PrismaClient, accountId: string, number: string): Promise<boolean> {
  const hit = await prisma.auditLog.findFirst({
    where: {
      accountId,
      entityType: 'invoice',
      OR: [
        { after: { path: ['retiredNumber'], equals: number } },
        // Deletions logged before retiredNumber was recorded (app/invoices/actions.ts).
        { action: 'delete', after: { path: ['summary'], equals: `Invoice ${number} deleted` } },
      ],
    },
    select: { id: true },
  })
  return !!hit
}

export async function saveInvoiceEdit(
  prisma: PrismaClient,
  accountId: string,
  invoiceId: string,
  input: InvoiceEditInput,
): Promise<SaveInvoiceEditResult> {
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId },
    select: {
      id: true,
      status: true,
      number: true,
      clientId: true,
      currency: true,
      paidCents: true,
      account: { select: { invoiceNumberSeq: true } },
      lineItems: {
        select: {
          id: true,
          itemTypeId: true,
          description: true,
          quantity: true,
          unitPriceCents: true,
          amountCents: true,
          linkedProjectId: true,
          taxable: true,
          sortOrder: true,
          _count: { select: { timeEntries: true, expenses: true } },
        },
      },
    },
  })
  if (!inv) return { ok: false, error: 'Invoice not found.' }
  if (inv.status !== 'draft' && inv.status !== 'open') return { ok: false, error: 'This invoice can no longer be edited.' }

  // ---- Header ----
  const issueRaw = input.issueDate.trim()
  const issueDate = issueRaw ? parseYmd(issueRaw) : null
  if (issueRaw && !issueDate) return { ok: false, error: 'Issue date is not a valid date.' }
  const paymentTerm: PaymentTerm = TERMS.includes(input.paymentTerm as PaymentTerm) ? (input.paymentTerm as PaymentTerm) : 'net_30'
  const customRaw = input.dueDate.trim()
  const customDue = customRaw ? parseYmd(customRaw) : null
  if (paymentTerm === 'custom' && !customDue) return { ok: false, error: 'Choose a custom due date.' }
  const dueDate = dueDateFor(paymentTerm, issueDate, customDue)
  if (issueDate && dueDate && dueDate < issueDate) return { ok: false, error: 'The due date is before the issue date.' }

  const discount = parsePercent(input.discountPercent)
  const tax1 = parsePercent(input.tax1Percent)
  const tax2 = parsePercent(input.tax2Percent)
  if (discount === undefined) return { ok: false, error: 'Discount must be a percentage between 0 and 100.' }
  if (tax1 === undefined || tax2 === undefined) return { ok: false, error: 'Tax must be a percentage between 0 and 100.' }

  const currency = input.currency.trim().toUpperCase() || inv.currency
  if (currency !== inv.currency) {
    if (!INVOICE_CURRENCIES.includes(currency)) return { ok: false, error: 'Unsupported currency.' }
    if (inv.paidCents > 0) return { ok: false, error: 'The currency cannot change once payments are recorded.' }
  }

  // ---- Lines ----
  if (input.lines.length > 1000) return { ok: false, error: 'Too many line items.' }
  const norm = normalizeLines(input.lines)
  if (!norm.ok) return norm
  const stored = inv.lineItems.map((li) => ({
    id: li.id,
    itemTypeId: li.itemTypeId,
    description: li.description,
    quantityHundredths: Math.round(Number(li.quantity) * 100),
    unitPriceCents: li.unitPriceCents,
    amountCents: li.amountCents,
    linkedProjectId: li.linkedProjectId,
    taxable: li.taxable,
    sortOrder: li.sortOrder,
  }))
  const diff = diffLineItems(stored, norm.value)
  if (!diff.ok) return diff
  const { added, updated, removed } = diff.value

  // Item types must be this account's; a newly linked project must be one of this client's (a line
  // may keep the link it already had, e.g. an imported one).
  const typeIds = [...new Set(norm.value.map((l) => l.itemTypeId).filter((x): x is string => !!x))]
  if (typeIds.length) {
    const n = await prisma.itemType.count({ where: { accountId, id: { in: typeIds } } })
    if (n !== typeIds.length) return { ok: false, error: 'An item type is no longer available — reload and try again.' }
  }
  const storedLinks = new Map(stored.map((s) => [s.id, s.linkedProjectId]))
  const newLinks = [
    ...new Set(norm.value.filter((l) => l.linkedProjectId && storedLinks.get(l.id ?? '') !== l.linkedProjectId).map((l) => l.linkedProjectId!)),
  ]
  if (newLinks.length) {
    const n = await prisma.project.count({ where: { accountId, clientId: inv.clientId, id: { in: newLinks } } })
    if (n !== newLinks.length) return { ok: false, error: "A linked project isn't one of this client's projects." }
  }

  // Changing currency under billed time/expenses would bill them in the wrong currency (specs/05).
  if (currency !== inv.currency) {
    const kept = new Set(norm.value.map((l) => l.id).filter(Boolean))
    if (inv.lineItems.some((li) => kept.has(li.id) && li._count.timeEntries + li._count.expenses > 0)) {
      return { ok: false, error: 'The currency cannot change while tracked time or expenses are on this invoice.' }
    }
  }

  // ---- Invoice ID (INV-6) ----
  const requested = input.number.trim()
  const checkNumber = requested !== '' && requested !== (inv.number ?? '')
  const [takenByOther, retired] = checkNumber
    ? await Promise.all([
        prisma.invoice.count({ where: { accountId, number: requested, id: { not: inv.id } } }).then((n) => n > 0),
        invoiceNumberRetired(prisma, accountId, requested),
      ])
    : [false, false]
  const num = validateInvoiceNumberChange({ current: inv.number, requested, status: inv.status, seq: inv.account.invoiceNumberSeq, takenByOther, retired })
  if (!num.ok) return num

  const releasedLineItemIds = inv.lineItems.filter((li) => removed.includes(li.id) && li._count.timeEntries + li._count.expenses > 0).map((li) => li.id)
  const qty = (h: number) => new Prisma.Decimal(h).div(100)

  try {
    await prisma.$transaction(async (tx) => {
      if (num.value.bumpSeqTo != null) {
        // Takes the Account row lock, so this serializes with allocateInvoiceNumber (send).
        await tx.$executeRaw`UPDATE "Account" SET "invoiceNumberSeq" = GREATEST("invoiceNumberSeq", ${num.value.bumpSeqTo}) WHERE id = ${accountId}`
      }
      if (removed.length) {
        // Release billed time / expenses back to the uninvoiced pool (INV-4), as delete does.
        await tx.timeEntry.updateMany({ where: { accountId, invoiceLineItemId: { in: removed } }, data: { invoiceLineItemId: null, lockState: 'open' } })
        await tx.expense.updateMany({ where: { accountId, invoiceLineItemId: { in: removed } }, data: { invoiceLineItemId: null, lockState: 'open' } })
        await tx.invoiceLineItem.deleteMany({ where: { accountId, invoiceId: inv.id, id: { in: removed } } })
      }
      for (const l of updated) {
        await tx.invoiceLineItem.update({
          where: { id: l.id },
          data: {
            itemTypeId: l.itemTypeId,
            description: l.description,
            quantity: qty(l.quantityHundredths),
            unitPriceCents: l.unitPriceCents,
            amountCents: l.amountCents,
            linkedProjectId: l.linkedProjectId,
            taxable: l.taxable,
            sortOrder: l.sortOrder,
          },
        })
      }
      if (added.length) {
        await tx.invoiceLineItem.createMany({
          data: added.map((l) => ({
            accountId,
            invoiceId: inv.id,
            kind: 'free_form' as const,
            itemTypeId: l.itemTypeId,
            description: l.description,
            quantity: qty(l.quantityHundredths),
            unitPriceCents: l.unitPriceCents,
            amountCents: l.amountCents,
            linkedProjectId: l.linkedProjectId,
            taxable: l.taxable,
            sortOrder: l.sortOrder,
          })),
        })
      }
      // Only touch a row that is still editable (a concurrent send / payment / write-off wins).
      const { count } = await tx.invoice.updateMany({
        where: { id: inv.id, accountId, status: { in: ['draft', 'open'] } },
        data: {
          number: num.value.number,
          subject: input.subject.trim() || null,
          poNumber: input.poNumber.trim() || null,
          notes: input.notes.trim() || null,
          issueDate,
          dueDate,
          paymentTerm,
          currency,
          discountPercent: discount != null ? new Prisma.Decimal(discount) : null,
          tax1Name: input.tax1Name.trim() || null,
          tax1Percent: tax1 != null ? new Prisma.Decimal(tax1) : null,
          tax2Name: input.tax2Name.trim() || null,
          tax2Percent: tax2 != null ? new Prisma.Decimal(tax2) : null,
          acceptOnlinePayments: input.acceptOnlinePayments,
          allowCardPayments: input.allowCardPayments,
          allowAchPayments: input.allowAchPayments,
        },
      })
      if (count === 0) throw new EditError('This invoice changed while you were editing — reload and try again.')
      // Throws (rolling everything back) if the new total would drop below what has been paid.
      await recomputeInvoiceTotals(tx, inv.id)
    })
  } catch (e) {
    if (e instanceof EditError) return { ok: false, error: e.message }
    if (isUniqueViolation(e)) return { ok: false, error: `Invoice ID ${requested} is already used by another invoice.` }
    return { ok: false, error: transitionErrorMessage(e, 'Could not save the invoice.') }
  }

  const parts: string[] = []
  if (added.length) parts.push(`${plural(added.length, 'line')} added`)
  if (updated.length) parts.push(`${plural(updated.length, 'line')} changed`)
  if (removed.length) parts.push(`${plural(removed.length, 'line')} removed`)
  return {
    ok: true,
    summary: `Invoice updated${parts.length ? ` (${parts.join(', ')})` : ''}`,
    renumbered: num.value.changed && num.value.number ? { from: inv.number, to: num.value.number } : null,
    releasedLineItemIds,
  }
}
