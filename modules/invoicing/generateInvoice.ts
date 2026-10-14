/**
 * generateInvoice — create a draft invoice from a client's uninvoiced tracked time (specs/05).
 *
 * Pulls the uninvoiced billable pool for the client (isUninvoiced predicate), groups it into
 * line items (groupTimeEntriesIntoLineItems), computes totals (computeTotals), and creates a
 * DRAFT invoice — reserving the entries (invoiceLineItemId set; they leave the pool but stay
 * lockState 'open' until the invoice is sent). Uninvoiced billable EXPENSES for the client are
 * pulled the same way and added as `expense` line items (billed amount = total × (1+markup)).
 * All in one transaction.
 *
 * Fixed-fee projects (Harvest): each fixed-fee project in scope gets ONE `flat` line for its
 * remaining uninvoiced fee (fee − already invoiced, modules/invoicing/fixedFee.ts); none when nothing
 * remains. Its tracked hours are NOT pulled in or linked — they stay uninvoiced hours.
 *
 * Safety rules (go-live audit):
 *  - Fixed-fee project time is NOT pulled in (the fee line bills the project, not its hours).
 *  - The fixed-fee projects are row-locked inside the transaction and their remaining fee re-derived;
 *    if another generation claimed some of it meanwhile, this one rolls back (no double-billed fee).
 *  - Billable T&M entries with no stored rate are re-resolved (resolveRate, as of spentDate); if any
 *    still lack a rate, generation is blocked with a GenerateInvoiceError naming them (no $0 lines).
 *  - Entries/expenses are reserved inside the transaction with a guarded updateMany
 *    (invoiceLineItemId still null, not invoiced) and a count check, so two concurrent generations
 *    can never put the same entry on two invoices (INV-4); the loser's transaction rolls back.
 */
import { Prisma, type PrismaClient } from '@prisma/client'
import { fixedFeeLine, fixedFeeStatus } from '@/modules/invoicing/fixedFee'
import { groupTimeEntriesIntoLineItems, type TimeEntryForInvoice, type TimeGrouping } from '@/modules/invoicing/lineItems'
import { computeTotals } from '@/modules/invoicing/totals'
import { percentOf } from '@/modules/shared/money'
import { resolvePoolRates, needsRate, missingRatesMessage, type PoolEntryRateContext, type RateLookups } from '@/modules/invoicing/rateCheck'

/** A user-facing generation failure (missing rates, lost a reservation race). */
export class GenerateInvoiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GenerateInvoiceError'
  }
}

const RACE_MESSAGE = 'Some of this time or expenses were just invoiced by someone else. Refresh and try again.'

/** Billed amount of an expense with its markup applied (integer cents, half-up; INV-1). */
export function expenseBilledCents(totalCents: number, markupPercent: number | null): number {
  return markupPercent ? totalCents + percentOf(totalCents, markupPercent) : totalCents
}

/** Load the assignment / person-rate rows resolveRate needs for the entries that lack a rate. */
async function loadRateLookups(prisma: PrismaClient, accountId: string, entries: PoolEntryRateContext[]): Promise<RateLookups> {
  const projectIds = [...new Set(entries.map((e) => e.projectId))]
  const userIds = [...new Set(entries.map((e) => e.userId))]
  const [taskAssignments, userAssignments, personRates] = await Promise.all([
    prisma.projectTaskAssignment.findMany({
      where: { accountId, projectId: { in: projectIds } },
      select: { projectId: true, taskId: true, billable: true, hourlyRateCents: true },
    }),
    prisma.projectUserAssignment.findMany({
      where: { accountId, projectId: { in: projectIds }, userId: { in: userIds } },
      select: { projectId: true, userId: true, hourlyRateCents: true },
    }),
    prisma.personBillableRate.findMany({
      where: { accountId, userId: { in: userIds } },
      select: { userId: true, hourlyRateCents: true, startDate: true, endDate: true },
    }),
  ])
  const rates = new Map<string, { hourlyRateCents: number; startDate: Date | null; endDate: Date | null }[]>()
  for (const r of personRates) rates.set(r.userId, [...(rates.get(r.userId) ?? []), r])
  return {
    taskAssignments: new Map(taskAssignments.map((a) => [`${a.projectId}|${a.taskId}`, a])),
    userAssignments: new Map(userAssignments.map((a) => [`${a.projectId}|${a.userId}`, a])),
    personRates: rates,
  }
}

export interface GenerateInvoiceInput {
  accountId: string
  clientId: string
  grouping?: TimeGrouping
  /**
   * Projects to invoice (Harvest's project picker). Omitted → every project of the client, with
   * fixed-fee lines only for its ACTIVE fixed-fee projects. Projects not on the client are ignored.
   */
  projectIds?: string[]
  /** Import tracked time and fixed-fee lines (default true). The API's `time` block; specs/22. */
  includeTime?: boolean
  /** Import billable expenses (default true). The API's `expenses` block. */
  includeExpenses?: boolean
  /** Inclusive spentDate window for time (date-only, UTC midnight). Omitted = all uninvoiced. */
  timeFrom?: Date
  timeTo?: Date
  /** Inclusive spentDate window for expenses. Omitted = all uninvoiced. */
  expenseFrom?: Date
  expenseTo?: Date
}

const dateWindow = (from?: Date, to?: Date) =>
  from || to ? { spentDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}

export async function generateInvoice(prisma: PrismaClient, input: GenerateInvoiceInput) {
  const grouping = input.grouping ?? 'by_task'

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: input.clientId },
    select: { id: true, name: true, currency: true, entityId: true, accountId: true },
  })
  if (client.accountId !== input.accountId) return null // INV-5
  const projectIds = input.projectIds ? [...new Set(input.projectIds)] : undefined
  if (projectIds && projectIds.length === 0) return null
  const projectScope = projectIds ? { id: { in: projectIds } } : {}

  const includeTime = input.includeTime ?? true
  const includeExpenses = input.includeExpenses ?? true

  const rows = !includeTime ? [] : await prisma.timeEntry.findMany({
    where: {
      ...dateWindow(input.timeFrom, input.timeTo),
      accountId: input.accountId,
      isBillable: true,
      isRunning: false,
      invoiceLineItemId: null,
      lockState: { not: 'invoiced' },
      // Fixed-fee time is billed by a manual line, never from hours (see header).
      project: { clientId: input.clientId, projectType: 'time_and_materials', ...projectScope },
    },
    select: {
      id: true,
      spentDate: true,
      minutes: true,
      notes: true,
      billableRateCents: true,
      lockState: true,
      project: {
        select: { id: true, name: true, code: true, projectType: true, projectFeesCents: true, billableRateMethod: true, projectHourlyRateCents: true },
      },
      task: { select: { id: true, name: true, defaultBillable: true, defaultHourlyRateCents: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  })

  // Uninvoiced billable expenses for this client (mirrors the time pool predicate).
  const expenseRows = !includeExpenses ? [] : await prisma.expense.findMany({
    where: {
      ...dateWindow(input.expenseFrom, input.expenseTo),
      accountId: input.accountId,
      isBillable: true,
      invoiceLineItemId: null,
      lockState: { not: 'invoiced' },
      project: { clientId: input.clientId, ...projectScope },
    },
    select: {
      id: true,
      spentDate: true,
      totalCents: true,
      markupPercent: true,
      notes: true,
      projectId: true,
      category: { select: { name: true } },
    },
    orderBy: { spentDate: 'asc' },
  })

  // Fixed-fee projects in scope → one line each for the remaining uninvoiced fee.
  const ffBefore = !includeTime ? [] : await fixedFeeStatus(prisma, input.accountId, {
    clientId: input.clientId,
    ...(projectIds ? { projectIds } : { activeOnly: true }),
  })
  const feeLines = ffBefore
    .map((p) => fixedFeeLine({ id: p.projectId, name: p.name, feeCents: p.feeCents }, p.invoicedCents))
    .filter((l): l is NonNullable<typeof l> => l != null)

  if (rows.length === 0 && expenseRows.length === 0 && feeLines.length === 0) return null // nothing to invoice

  // Re-derive missing rates (INV-2); block generation when any are still missing.
  const rateCtx: PoolEntryRateContext[] = rows.map((r) => ({
    id: r.id,
    spentDate: r.spentDate,
    billableRateCents: r.billableRateCents,
    projectId: r.project.id,
    projectName: r.project.name,
    projectType: r.project.projectType,
    billableRateMethod: r.project.billableRateMethod,
    projectHourlyRateCents: r.project.projectHourlyRateCents,
    taskId: r.task.id,
    taskName: r.task.name,
    taskDefaultBillable: r.task.defaultBillable,
    taskDefaultHourlyRateCents: r.task.defaultHourlyRateCents,
    userId: r.user.id,
    userName: `${r.user.firstName} ${r.user.lastName ?? ''}`.trim(),
  }))
  const needing = rateCtx.filter(needsRate)
  let resolvedRates = new Map<string, number>()
  if (needing.length > 0) {
    const { resolved, missing } = resolvePoolRates(needing, await loadRateLookups(prisma, input.accountId, needing))
    if (missing.length > 0) throw new GenerateInvoiceError(missingRatesMessage(missing))
    resolvedRates = resolved
  }
  // Persist re-derived rates onto still-editable ('open') entries; approved entries are immutable
  // (INV-3) so their line simply uses the derived rate.
  const rateUpdates = rows.filter((r) => resolvedRates.has(r.id) && r.lockState === 'open').map((r) => ({ id: r.id, rate: resolvedRates.get(r.id)! }))

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
    billableRateCents: resolvedRates.get(r.id) ?? r.billableRateCents,
    notes: r.notes,
  }))

  const lineItems = [...feeLines, ...groupTimeEntriesIntoLineItems(entries, grouping)]

  // Each expense becomes its own line item; billed amount applies the markup.
  const ymd = (d: Date) => d.toISOString().slice(0, 10)
  const expenseItems = expenseRows.map((e) => {
    const amountCents = expenseBilledCents(e.totalCents, e.markupPercent ? Number(e.markupPercent) : null)
    const label = e.notes ? `${e.category.name} — ${e.notes}` : `${e.category.name} (${ymd(e.spentDate)})`
    return { expenseId: e.id, projectId: e.projectId, description: label, amountCents }
  })

  const totals = computeTotals({
    lineItems: [
      ...lineItems.map((li) => ({ amountCents: li.amountCents, taxable: true })),
      ...expenseItems.map((li) => ({ amountCents: li.amountCents, taxable: true })),
    ],
  })

  const serviceType = await prisma.itemType.findFirst({
    where: { accountId: input.accountId, name: 'Service', isSystemDefault: true },
    select: { id: true },
  })

  return prisma.$transaction(async (tx) => {
    for (const u of rateUpdates) {
      await tx.timeEntry.updateMany({
        where: { id: u.id, accountId: input.accountId, lockState: 'open', invoiceLineItemId: null },
        data: { billableRateCents: u.rate },
      })
    }
    if (feeLines.length > 0) {
      // Serialize fee claims per project, then re-derive what remains: a concurrent generation that
      // already billed (part of) the fee makes this one roll back instead of double-billing it.
      const ids = feeLines.map((l) => l.linkedProjectId)
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Project" WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`)
      const current = await fixedFeeStatus(tx, input.accountId, { projectIds: ids })
      for (const l of feeLines) {
        const cur = current.find((p) => p.projectId === l.linkedProjectId)
        if (!cur || cur.remainingCents !== l.amountCents) throw new GenerateInvoiceError(RACE_MESSAGE)
      }
    }
    const invoice = await tx.invoice.create({
      data: {
        accountId: input.accountId,
        clientId: client.id,
        // Stamp the business entity from the client so routing (sender/branding/Stripe/Xero) is fixed (specs/16).
        entityId: client.entityId,
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
          taxable: true,
          sortOrder: sortOrder++,
        },
      })
      if (li.sourceEntryIds.length > 0) {
        // Reserve the entries onto this line item (leaves the uninvoiced pool; INV-4).
        // Guarded: only entries still unreserved + not invoiced; a short count means another
        // generation won the race, so throw and roll the whole draft back.
        const res = await tx.timeEntry.updateMany({
          where: {
            id: { in: li.sourceEntryIds },
            accountId: input.accountId,
            invoiceLineItemId: null,
            lockState: { not: 'invoiced' },
            isBillable: true,
            isRunning: false,
          },
          data: { invoiceLineItemId: created.id },
        })
        if (res.count !== li.sourceEntryIds.length) throw new GenerateInvoiceError(RACE_MESSAGE)
      }
    }

    for (const ei of expenseItems) {
      const created = await tx.invoiceLineItem.create({
        data: {
          accountId: input.accountId,
          invoiceId: invoice.id,
          kind: 'expense',
          linkedProjectId: ei.projectId,
          description: ei.description,
          quantity: 1,
          unitPriceCents: ei.amountCents,
          amountCents: ei.amountCents,
          taxable: true,
          sortOrder: sortOrder++,
        },
      })
      // Reserve the expense onto this line item (leaves the pool; locked to 'invoiced' on send).
      const res = await tx.expense.updateMany({
        where: { id: ei.expenseId, accountId: input.accountId, invoiceLineItemId: null, lockState: { not: 'invoiced' } },
        data: { invoiceLineItemId: created.id },
      })
      if (res.count !== 1) throw new GenerateInvoiceError(RACE_MESSAGE)
    }

    return invoice
  })
}
