import { describe, it, expect } from 'vitest'
import { projectFeeCents, remainingFeeCents, fixedFeeLine, invoicedForProject, countsTowardFee } from './fixedFee'
import { groupTimeEntriesIntoLineItems, type TimeEntryForInvoice } from './lineItems'

const P = { id: 'prj_logo', name: 'Logo', feeCents: 100000 } // $1,000 fee

describe('fixed-fee invoicing (Harvest)', () => {
  it('project fee = projectFeesCents, falling back to a fee_total budget', () => {
    expect(projectFeeCents({ projectFeesCents: 500000 })).toBe(500000)
    expect(projectFeeCents({ projectFeesCents: null, budgetMethod: 'fee_total', budgetValue: 250000 })).toBe(250000)
    expect(projectFeeCents({ projectFeesCents: null, budgetMethod: 'hours_total', budgetValue: 6000 })).toBeNull()
    expect(projectFeeCents({ projectFeesCents: 0, budgetMethod: 'fee_total', budgetValue: 9 })).toBe(0)
  })

  it('remaining = fee − invoiced, floored at 0; no fee → 0', () => {
    expect(remainingFeeCents(100000, 0)).toBe(100000)
    expect(remainingFeeCents(100000, 60000)).toBe(40000)
    expect(remainingFeeCents(100000, 100000)).toBe(0)
    expect(remainingFeeCents(100000, 120000)).toBe(0)
    expect(remainingFeeCents(null, 0)).toBe(0)
  })

  it('AC-INV-003: first invoice gets ONE flat line for the whole fee, with no time entries attached', () => {
    const li = fixedFeeLine(P, 0)!
    expect(li).toEqual({
      kind: 'flat', description: 'Logo', quantityHours: 1, unitPriceCents: 100000, amountCents: 100000, linkedProjectId: 'prj_logo', sourceEntryIds: [],
    })
  })

  it('AC-INV-003a: unit price lowered to $600 on the draft → the remaining $400 is pulled onto the next invoice', () => {
    const first = fixedFeeLine(P, 0)!
    // The user edits the draft's unit price down to $600.
    const lines = [{ kind: first.kind, linkedProjectId: first.linkedProjectId, amountCents: 60000 }]
    const invoiced = invoicedForProject(lines, P.id)
    expect(invoiced).toBe(60000)
    const second = fixedFeeLine(P, invoiced)!
    expect(second.amountCents).toBe(40000)
    expect(second.unitPriceCents).toBe(40000)
    // After the second invoice the fee is fully invoiced.
    lines.push({ kind: second.kind, linkedProjectId: P.id, amountCents: second.amountCents })
    expect(fixedFeeLine(P, invoicedForProject(lines, P.id))).toBeNull()
  })

  it('AC-INV-003b: fully invoiced (or no fee set) → no fixed-fee line', () => {
    expect(fixedFeeLine(P, 100000)).toBeNull()
    expect(fixedFeeLine(P, 150000)).toBeNull()
    expect(fixedFeeLine({ ...P, feeCents: null }, 0)).toBeNull()
    expect(fixedFeeLine({ ...P, feeCents: 0 }, 0)).toBeNull()
  })

  it('invoiced amount counts every linked non-expense line for that project only', () => {
    const lines = [
      { kind: 'flat', linkedProjectId: 'prj_logo', amountCents: 30000 },
      { kind: 'free_form', linkedProjectId: 'prj_logo', amountCents: 20000 }, // e.g. imported from Harvest
      { kind: 'expense', linkedProjectId: 'prj_logo', amountCents: 9999 }, // expenses bill on top of the fee
      { kind: 'flat', linkedProjectId: 'prj_other', amountCents: 50000 },
      { kind: 'free_form', linkedProjectId: null, amountCents: 1 },
    ]
    expect(invoicedForProject(lines, 'prj_logo')).toBe(50000)
    expect(countsTowardFee({ kind: 'expense', linkedProjectId: 'prj_logo' }, 'prj_logo')).toBe(false)
  })

  it('AC-INV-003c: fixed-fee hours are never linked to the invoice (stay uninvoiced hours)', () => {
    const base: TimeEntryForInvoice = {
      id: 'ff1', projectId: 'prj_logo', projectName: 'Logo', projectType: 'fixed_fee', projectFeesCents: 100000,
      taskId: 't', taskName: 'Design', userId: 'u', userName: 'Frank', spentDate: new Date('2026-07-02T00:00:00Z'), minutes: 600, billableRateCents: 0,
    }
    const timeLines = groupTimeEntriesIntoLineItems([base, { ...base, id: 'tm1', projectId: 'prj_web', projectType: 'time_and_materials', billableRateCents: 12000, minutes: 60 }], 'by_project')
    const all = [fixedFeeLine(P, 0)!, ...timeLines]
    expect(all.flatMap((l) => l.sourceEntryIds)).toEqual(['tm1'])
    expect(all.filter((l) => l.linkedProjectId === 'prj_logo')).toHaveLength(1)
    expect(all.reduce((s, l) => s + l.amountCents, 0)).toBe(100000 + 12000)
  })
})
