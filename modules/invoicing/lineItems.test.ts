import { describe, it, expect } from 'vitest'
import { groupTimeEntriesIntoLineItems, type TimeEntryForInvoice } from './lineItems'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function entry(partial: Partial<TimeEntryForInvoice> & Pick<TimeEntryForInvoice, 'id' | 'minutes'>): TimeEntryForInvoice {
  return {
    projectId: 'prj_web',
    projectName: 'Website',
    projectCode: 'WEB',
    projectType: 'time_and_materials',
    projectFeesCents: null,
    taskId: 'task_design',
    taskName: 'Design',
    userId: 'usr_frank',
    userName: 'Frank',
    spentDate: d('2026-07-02'),
    billableRateCents: 12000,
    notes: null,
    ...partial,
  }
}

describe('groupTimeEntriesIntoLineItems', () => {
  it('AC-INV-001: by_task merges same-task same-rate entries; amounts = hours × rate', () => {
    const items = groupTimeEntriesIntoLineItems(
      [
        entry({ id: 'a', minutes: 120, taskId: 'task_design', taskName: 'Design', billableRateCents: 12000 }),
        entry({ id: 'b', minutes: 60, taskId: 'task_design', taskName: 'Design', billableRateCents: 12000 }),
        entry({ id: 'c', minutes: 240, taskId: 'task_dev', taskName: 'Development', billableRateCents: 15000 }),
      ],
      'by_task',
    )
    expect(items).toHaveLength(2)
    const design = items.find((i) => i.description === 'Design')!
    const dev = items.find((i) => i.description === 'Development')!
    expect(design.quantityHours).toBe(3)
    expect(design.amountCents).toBe(36000) // 3h @ $120
    expect(design.sourceEntryIds).toEqual(['a', 'b'])
    expect(dev.amountCents).toBe(60000) // 4h @ $150
    expect(items.reduce((s, i) => s + i.amountCents, 0)).toBe(96000) // $960 subtotal
  })

  it('AC-INV-002: same task at two different rates splits into two lines', () => {
    const items = groupTimeEntriesIntoLineItems(
      [
        entry({ id: 'a', minutes: 60, billableRateCents: 12000 }),
        entry({ id: 'b', minutes: 60, billableRateCents: 15000 }),
      ],
      'by_task',
    )
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.unitPriceCents).sort()).toEqual([12000, 15000])
  })

  it('AC-INV-003: fixed-fee project yields one flat line of the fee, not hours × rate', () => {
    const items = groupTimeEntriesIntoLineItems(
      [
        entry({ id: 'a', minutes: 600, projectId: 'prj_logo', projectName: 'Logo', projectType: 'fixed_fee', projectFeesCents: 500000, billableRateCents: 0 }),
        entry({ id: 'b', minutes: 600, projectId: 'prj_logo', projectName: 'Logo', projectType: 'fixed_fee', projectFeesCents: 500000, billableRateCents: 0 }),
      ],
      'by_task',
    )
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('flat')
    expect(items[0].amountCents).toBe(500000)
    expect(items[0].sourceEntryIds).toEqual(['a', 'b']) // entries still captured (caller marks invoiced)
  })

  it('detailed grouping emits one line per entry with a descriptive label', () => {
    const items = groupTimeEntriesIntoLineItems(
      [entry({ id: 'a', minutes: 90, notes: 'Hero', taskName: 'Design', userName: 'Frank' })],
      'detailed',
    )
    expect(items).toHaveLength(1)
    expect(items[0].description).toBe('[WEB] 2026-07-02 - Design / Frank: Hero')
    expect(items[0].amountCents).toBe(18000) // 1.5h @ $120
  })

  it('by_person groups across tasks for the same person + rate', () => {
    const items = groupTimeEntriesIntoLineItems(
      [
        entry({ id: 'a', minutes: 60, userId: 'usr_frank', userName: 'Frank', taskId: 'task_design' }),
        entry({ id: 'b', minutes: 120, userId: 'usr_frank', userName: 'Frank', taskId: 'task_dev' }),
      ],
      'by_person',
    )
    expect(items).toHaveLength(1)
    expect(items[0].description).toBe('Frank')
    expect(items[0].quantityHours).toBe(3)
  })

  it('keeps different projects on separate lines even when grouping by task', () => {
    const items = groupTimeEntriesIntoLineItems(
      [
        entry({ id: 'a', minutes: 60, projectId: 'prj_web', taskId: 'task_design' }),
        entry({ id: 'b', minutes: 60, projectId: 'prj_app', taskId: 'task_design' }),
      ],
      'by_task',
    )
    expect(items).toHaveLength(2)
  })
})
