/**
 * Group tracked time into invoice line items (specs/05-invoicing.md §Grouping tracked time).
 *
 * Pure function. Splits every grouping by distinct rate (a line item has ONE unit price).
 * Fixed-fee projects contribute a single flat line of the project fee regardless of hours
 * (their entries are still marked invoiced by the caller, but do not multiply out).
 */
import { lineAmountCents } from '../shared/money'

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
const hours = (minutes: number) => minutes / 60

/**
 * @param entries billable time entries already pulled from the uninvoiced pool
 * @param grouping account/invoice timeGrouping setting
 */
export function groupTimeEntriesIntoLineItems(
  entries: TimeEntryForInvoice[],
  grouping: TimeGrouping,
): GeneratedLineItem[] {
  const items: GeneratedLineItem[] = []

  // 1. Fixed-fee projects → one flat line per project (fee, not hours × rate).
  const fixedByProject = new Map<string, TimeEntryForInvoice[]>()
  const timeEntries: TimeEntryForInvoice[] = []
  for (const e of entries) {
    if (e.projectType === 'fixed_fee') {
      const list = fixedByProject.get(e.projectId) ?? []
      list.push(e)
      fixedByProject.set(e.projectId, list)
    } else {
      timeEntries.push(e)
    }
  }
  for (const [projectId, list] of fixedByProject) {
    const fee = list[0].projectFeesCents ?? 0
    items.push({
      kind: 'flat',
      description: list[0].projectName,
      quantityHours: 1,
      unitPriceCents: fee,
      amountCents: fee,
      linkedProjectId: projectId,
      sourceEntryIds: list.map((e) => e.id),
    })
  }

  // 2. Time & materials → grouped, split by distinct rate.
  if (grouping === 'detailed') {
    for (const e of timeEntries) {
      const rate = e.billableRateCents ?? 0
      const qty = hours(e.minutes)
      const label = `[${e.projectCode ?? e.projectName}] ${isoDate(e.spentDate)} - ${e.taskName} / ${e.userName}${e.notes ? `: ${e.notes}` : ''}`
      items.push({
        kind: 'time',
        description: label,
        quantityHours: qty,
        unitPriceCents: rate,
        amountCents: lineAmountCents(qty, rate),
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
    const qty = hours(totalMinutes)
    const description =
      grouping === 'by_task' ? first.taskName : grouping === 'by_person' ? first.userName : first.projectName
    items.push({
      kind: 'time',
      description,
      quantityHours: qty,
      unitPriceCents: rate,
      amountCents: lineAmountCents(qty, rate),
      linkedProjectId: first.projectId,
      sourceEntryIds: list.map((e) => e.id),
    })
  }

  return items
}
