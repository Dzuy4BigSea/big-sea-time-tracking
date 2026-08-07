import { describe, it, expect } from 'vitest'
import { reconcileEntity, reconcile, formatReconTable, type ReconInput } from './reconcile'

const base: ReconInput = { entity: 'user', label: 'People', resource: 'users', sourceRows: 0, mappedIds: 0, dbRows: 0, ran: true }

describe('reconcileEntity', () => {
  it('ok when every source row mapped', () => {
    const r = reconcileEntity({ ...base, sourceRows: 130, mappedIds: 130, dbRows: 132 })
    expect(r.status).toBe('ok')
    expect(r.unmapped).toBe(0)
  })

  it('ok with extra mapped rows (pre-existing records matched)', () => {
    const r = reconcileEntity({ ...base, sourceRows: 130, mappedIds: 131, dbRows: 131 })
    expect(r.status).toBe('ok')
    expect(r.note).toMatch(/extra mapped/)
  })

  it('partial when unmapped within declared tolerance', () => {
    const r = reconcileEntity({ ...base, entity: 'time_entry', label: 'Time', sourceRows: 1000, mappedIds: 995, dbRows: 995, expectedSkips: 10 })
    expect(r.status).toBe('partial')
    expect(r.unmapped).toBe(5)
  })

  it('mismatch when unmapped exceeds tolerance', () => {
    const r = reconcileEntity({ ...base, sourceRows: 1000, mappedIds: 900, dbRows: 900, expectedSkips: 10 })
    expect(r.status).toBe('mismatch')
    expect(r.unmapped).toBe(100)
  })

  it('pending when the stage has not run in this phase', () => {
    const r = reconcileEntity({ ...base, entity: 'project', sourceRows: 2649, mappedIds: 0, dbRows: 0, ran: false })
    expect(r.status).toBe('pending')
  })

  it('ok when there are no source rows', () => {
    const r = reconcileEntity({ ...base, sourceRows: 0, mappedIds: 0, dbRows: 0 })
    expect(r.status).toBe('ok')
  })

  it('never reports negative unmapped', () => {
    const r = reconcileEntity({ ...base, sourceRows: 5, mappedIds: 9, dbRows: 9 })
    expect(r.unmapped).toBe(0)
  })
})

describe('reconcile (aggregate)', () => {
  it('ok overall when all entities ok/partial/pending', () => {
    const { ok, rows } = reconcile([
      { ...base, entity: 'client', label: 'Clients', sourceRows: 594, mappedIds: 594, dbRows: 594 },
      { ...base, entity: 'user', label: 'People', sourceRows: 130, mappedIds: 130, dbRows: 132 },
      { ...base, entity: 'project', label: 'Projects', sourceRows: 2649, mappedIds: 0, dbRows: 0, ran: false },
    ])
    expect(ok).toBe(true)
    expect(rows).toHaveLength(3)
  })

  it('not ok when any entity mismatches', () => {
    const { ok } = reconcile([
      { ...base, entity: 'client', label: 'Clients', sourceRows: 594, mappedIds: 594, dbRows: 594 },
      { ...base, entity: 'project', label: 'Projects', sourceRows: 2649, mappedIds: 2000, dbRows: 2000 },
    ])
    expect(ok).toBe(false)
  })
})

describe('formatReconTable', () => {
  it('renders a header and one row per entity', () => {
    const { rows } = reconcile([{ ...base, entity: 'user', label: 'People', sourceRows: 130, mappedIds: 130, dbRows: 130 }])
    const table = formatReconTable(rows)
    expect(table).toMatch(/entity/)
    expect(table).toMatch(/People/)
    expect(table.split('\n')).toHaveLength(3) // header + separator + 1 row
  })
})
