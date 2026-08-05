/**
 * generateInvoice — create a draft invoice from a client's uninvoiced tracked time (specs/05).
 *
 * Pulls the uninvoiced billable pool for the client (isUninvoiced predicate), groups it into
 * line items (groupTimeEntriesIntoLineItems), computes totals (computeTotals), and creates a
 * DRAFT invoice — reserving the entries (invoiceLineItemId set; they leave the pool but stay
 * lockState 'open' until the invoice is sent). All in one transaction.
 */
import type { PrismaClient } from '@prisma/client'
import { groupTimeEntriesIntoLineItems, type TimeEntryForInvoice, type TimeGrouping } from '@/modules/invoicing/lineItems'
import { computeTotals } from '@/modules/invoicing/totals'

export interface GenerateInvoiceInput {
  accountId: string
  clientId: string
  grouping?: TimeGrouping
}

export async function generateInvoice(prisma: PrismaClient, input: GenerateInvoiceInput) {
  const grouping = input.grouping ?? 'by_task'

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: input.clientId },
    select: { id: true, name: true, currency: true },
  })

  const rows = await prisma.timeEntry.findMany({
    where: {
      accountId: input.accountId,
      isBillable: true,
      isRunning: false,
      invoiceLineItemId: null,
      lockState: { not: 'invoiced' },
      project: { clientId: input.clientId },
    },
    select: {
      id: true,
      spentDate: true,
      minutes: true,
      notes: true,
      billableRateCents: true,
      project: { select: { id: true, name: true, code: true, projectType: true, projectFeesCents: true } },
      task: { select: { id: true, name: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  })

  if (rows.length === 0) return null // nothing to invoice

  const entries: TimeEntryForInvoice[] = rows.map((r) => ({
    id: r.id,
    projectId: r.project.id,
    projectName: r.project.name,
    projectCode: r.project.code,
    projectType: r.project.projectType,
    projectFeesCents: r.project.projectFeesCents,
    taskId: r.task.id,
    taskName: r.task.name,
    userId: r.user.id,
    userName: r.user.firstName,
    spentDate: r.spentDate,
    minutes: r.minutes,
    billableRateCents: r.billableRateCents,
    notes: r.notes,
  }))

  const lineItems = groupTimeEntriesIntoLineItems(entries, grouping)
  const totals = computeTotals({ lineItems: lineItems.map((li) => ({ amountCents: li.amountCents, taxable: false })) })

  const serviceType = await prisma.itemType.findFirst({
    where: { accountId: input.accountId, name: 'Service', isSystemDefault: true },
    select: { id: true },
  })

  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        accountId: input.accountId,
        clientId: client.id,
        status: 'draft',
        currency: client.currency,
        paymentTerm: 'net_30',
        subject: `${client.name} — services`,
        subtotalCents: totals.subtotalCents,
        totalCents: totals.totalCents,
      },
    })

    let sortOrder = 0
    for (const li of lineItems) {
      const created = await tx.invoiceLineItem.create({
        data: {
          accountId: input.accountId,
          invoiceId: invoice.id,
          kind: li.kind,
          itemTypeId: serviceType?.id ?? null,
          linkedProjectId: li.linkedProjectId,
          description: li.description,
          quantity: li.quantityHours,
          unitPriceCents: li.unitPriceCents,
          amountCents: li.amountCents,
          taxable: false,
          sortOrder: sortOrder++,
        },
      })
      if (li.sourceEntryIds.length > 0) {
        // Reserve the entries onto this line item (leaves the uninvoiced pool; INV-4).
        await tx.timeEntry.updateMany({
          where: { id: { in: li.sourceEntryIds } },
          data: { invoiceLineItemId: created.id },
        })
      }
    }

    return invoice
  })
}
