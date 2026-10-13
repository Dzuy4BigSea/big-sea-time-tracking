import { describe, it, expect } from 'vitest'
import { cleanParams, sameParams, canView, canEdit, inFilter, savedReportHref, isSavedReportKind } from './savedReports'

const me = 'u1'
const other = 'u2'
const r = (o: Partial<{ createdById: string; shared: boolean; archivedAt: Date | null }>) => ({ createdById: me, shared: false, archivedAt: null, ...o })

describe('cleanParams', () => {
  it('drops transient, empty and non-string values and sorts keys', () => {
    expect(cleanParams({ tab: 'projects', saved: 'x', edit: '1', empty: '', n: 3, period: 'week' })).toEqual({ period: 'week', tab: 'projects' })
    expect(Object.keys(cleanParams({ b: '1', a: '1' }))).toEqual(['a', 'b'])
  })
})

describe('sameParams', () => {
  it('ignores order and the saved marker', () => {
    expect(sameParams({ a: '1', b: '2', saved: 'x' }, { b: '2', a: '1' })).toBe(true)
    expect(sameParams({ a: '1' }, { a: '2' })).toBe(false)
    expect(sameParams({ a: '1' }, { a: '1', b: '2' })).toBe(false)
  })
})

describe('permissions', () => {
  it('creator or shared can view; creator or admin can edit', () => {
    expect(canView(r({}), me)).toBe(true)
    expect(canView(r({ createdById: other }), me)).toBe(false)
    expect(canView(r({ createdById: other, shared: true }), me)).toBe(true)
    expect(canEdit(r({ createdById: other }), me, 'member')).toBe(false)
    expect(canEdit(r({ createdById: other }), me, 'administrator')).toBe(true)
    expect(canEdit(r({}), me, 'member')).toBe(true)
  })
})

describe('inFilter', () => {
  const mine = r({})
  const theirsShared = r({ createdById: other, shared: true })
  const archived = r({ archivedAt: new Date() })
  it('splits mine / shared with me / archived', () => {
    expect([mine, theirsShared, archived].filter((x) => inFilter(x, me, 'all'))).toEqual([mine, theirsShared])
    expect([mine, theirsShared, archived].filter((x) => inFilter(x, me, 'mine'))).toEqual([mine])
    expect([mine, theirsShared, archived].filter((x) => inFilter(x, me, 'shared'))).toEqual([theirsShared])
    expect([mine, theirsShared, archived].filter((x) => inFilter(x, me, 'archived'))).toEqual([archived])
  })
})

describe('savedReportHref', () => {
  it('opens the kind page with the stored params and the saved marker', () => {
    expect(savedReportHref({ id: 's1', kind: 'detailed_time', params: { range: 'last_month', clients: 'a,b' } })).toBe(
      '/reports/detailed?clients=a%2Cb&range=last_month&saved=s1',
    )
    expect(savedReportHref({ id: 's2', kind: 'time_summary', params: null })).toBe('/reports?saved=s2')
  })
})

describe('isSavedReportKind', () => {
  it('accepts only known kinds', () => {
    expect(isSavedReportKind('detailed_expense')).toBe(true)
    expect(isSavedReportKind('pivot')).toBe(false)
  })
})
