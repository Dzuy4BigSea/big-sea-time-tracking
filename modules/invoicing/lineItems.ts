/**
 * Group tracked time into invoice line items (specs/05-invoicing.md §Grouping tracked time).
 *
 * Pure function. Splits every grouping by distinct rate (a line item has ONE unit price).
 *
 * Fixed-fee projects are NOT billed from tracked time (Harvest): their fee is billed as ONE line for
 * the remaining uninvoiced fee (modules/invoicing/fixedFee.ts → fixedFeeLine), and their hours are
 * never attached to the invoice — they stay "uninvoiced hours". The caller (generateInvoice) leaves
 * fixed-fee time out of the pool; this function also ignores any such entry defensively.
 *
 * Line math: quantity is the hours rounded half-up to 2 decimals (what the invoice, the client and
 * Xero see), and amount = rounded quantity × rate, so quantity × unit price always equals amount.
 */
import { roundHalfUp } from '../shared/money'

export type TimeGrouping = 'by_task' | 'by_project' | 'by_person' | 'detailed'

export interface TimeEntryForInvoice {
  id: string
  projectId: string
  projectName: string
  projectCode?: string | null
  projectType: 'time_and_materials' | 'fixed_fee' | 'non_billable'
  projectFeesCents?: number | null
  taskId: string
  taskName: string
  userId: string
  userName: string
  spentDate: Date
  minutes: number
  billableRateCents: number | null
  notes?: string | null
}

export interface GeneratedLineItem {
  kind: 'time' | 'flat'
  description: string
  quantityHours: number
  unitPriceCents: number
  amountCents: number
  linkedProjectId: string
  sourceEntryIds: string[]
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10)

/** Hours for `minutes`, in hundredths, rounded half-up (integer — e.g. 20 min → 33 = 0.33 h). */
export function hoursHundredths(minutes: number): number {
  return roundHalfUp((minutes * 100) / 60)
}

/** Line amount in cents for a quantity in hundredths of an hour × an hourly rate, half-up. */
export function amountForHundredths(hundredths: number, rateCents: number): number {
  return roundHalfUp((hundredths * rateCents) / 100)
}

/** The displayed quantity + amount for `minutes` of time at `rateCents`/hour. */
export function timeLine(minutes: number, rateCents: number): { quantityHours: number; amountCents: number } {
  const h = hoursHundredths(minutes)
  return { quantityHours: h / 100, amountCents: amountForHundredths(h, rateCents) }
}

/**
 * @param entries billable time entries already pulled from the uninvoiced pool
 * @param grouping account/invoice timeGrouping setting
 */
export function groupTimeEntriesIntoLineItems(
  entries: TimeEntryForInvoice[],
  grouping: TimeGrouping,
): GeneratedLineItem[] {
  const items: GeneratedLineItem[] = []

  // Fixed-fee time is never billed from hours (see header); only time & materials is grouped.
  const timeEntries = entries.filter((e) => e.projectType === 'time_and_materials')

  // Time & materials → grouped, split by distinct rate.
  if (grouping === 'detailed') {
    for (const e of timeEntries) {
      const rate = e.billableRateCents ?? 0
      const { quantityHours, amountCents } = timeLine(e.minutes, rate)
      const label = `[${e.projectCode ?? e.projectName}] ${isoDate(e.spentDate)} - ${e.taskName} / ${e.userName}${e.notes ? `: ${e.notes}` : ''}`
      items.push({
        kind: 'time',
        description: label,
        quantityHours,
        unitPriceCents: rate,
        amountCents,
        linkedProjectId: e.projectId,
        sourceEntryIds: [e.id],
      })
    }
    return items
  }

  const groups = new Map<string, TimeEntryForInvoice[]>()
  const order: string[] = []
  for (const e of timeEntries) {
    const rate = e.billableRateCents ?? 0
    const dim =
      grouping === 'by_task' ? e.taskId : grouping === 'by_person' ? e.userId : e.projectId
    const key = `${e.projectId}|${dim}|${rate}` // keep projects distinct even when grouping by task/person
    if (!groups.has(key)) {
      groups.set(key, [])
      order.push(key)
    }
    groups.get(key)!.push(e)
  }

  for (const key of order) {
    const list = groups.get(key)!
    const first = list[0]
    const rate = first.billableRateCents ?? 0
    const totalMinutes = list.reduce((s, e) => s + e.minutes, 0)
    const { quantityHours, amountCents } = timeLine(totalMinutes, rate)
    const description =
      grouping === 'by_task' ? first.taskName : grouping === 'by_person' ? first.userName : first.projectName
    items.push({
      kind: 'time',
      description,
      quantityHours,
      unitPriceCents: rate,
      amountCents,
      linkedProjectId: first.projectId,
      sourceEntryIds: list.map((e) => e.id),
    })
  }

  return items
}
