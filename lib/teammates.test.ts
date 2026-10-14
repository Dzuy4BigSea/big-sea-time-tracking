import { describe, it, expect } from 'vitest'
import { filterPeople, groupTeammates, timesheetHrefFor } from './teammates'

const people = [
  { id: 'u1', name: 'Dzuy Linh' },
  { id: 'u2', name: 'John Smith' },
  { id: 'u3', name: 'Zoë Quinn' },
  { id: 'u4', name: 'Johanna Ng' },
]

describe('filterPeople', () => {
  it('returns everyone for a blank query', () => {
    expect(filterPeople(people, '  ')).toHaveLength(4)
  })
  it('matches case-insensitively and keeps order', () => {
    expect(filterPeople(people, 'JOH').map((p) => p.id)).toEqual(['u2', 'u4'])
  })
  it('requires every typed term', () => {
    expect(filterPeople(people, 'jo sm').map((p) => p.id)).toEqual(['u2'])
  })
  it('ignores accents', () => {
    expect(filterPeople(people, 'zoe').map((p) => p.id)).toEqual(['u3'])
  })
  it('returns nothing when no one matches', () => {
    expect(filterPeople(people, 'xyz')).toEqual([])
  })
})

describe('timesheetHrefFor', () => {
  it('sets ?user and keeps the week', () => {
    expect(timesheetHrefFor('week=2026-10-05', 'u2', 'u1')).toBe('/timesheet?week=2026-10-05&user=u2')
  })
  it('replaces an existing ?user', () => {
    expect(timesheetHrefFor('week=2026-10-05&user=u3', 'u2', 'u1')).toBe('/timesheet?week=2026-10-05&user=u2')
  })
  it('drops ?user when picking yourself', () => {
    expect(timesheetHrefFor('week=2026-10-05&user=u3', 'u1', 'u1')).toBe('/timesheet?week=2026-10-05')
    expect(timesheetHrefFor('user=u3', 'u1', 'u1')).toBe('/timesheet')
  })
  it('keeps the day view and date', () => {
    expect(timesheetHrefFor('view=day&date=2026-10-07', 'u3', 'u1')).toBe('/timesheet?view=day&date=2026-10-07&user=u3')
  })
  it('targets another page, e.g. the Expenses Teammates button (specs/26 AC-EXP-113)', () => {
    expect(timesheetHrefFor('', 'u2', 'u1', '/expenses')).toBe('/expenses?user=u2')
    expect(timesheetHrefFor('user=u2', 'u1', 'u1', '/expenses')).toBe('/expenses')
  })
})

describe('groupTeammates', () => {
  it('puts employees first, then contractors, keeping order and dropping empty groups', () => {
    const ppl = [
      { id: 'a', name: 'Me', type: 'contractor' as const },
      { id: 'b', name: 'Ann', type: 'employee' as const },
      { id: 'c', name: 'Bob' },
      { id: 'd', name: 'Cal', type: 'contractor' as const },
    ]
    expect(groupTeammates(ppl).map((g) => [g.label, g.people.map((p) => p.id)])).toEqual([
      ['Employees', ['b', 'c']],
      ['Contractors', ['a', 'd']],
    ])
    expect(groupTeammates(ppl.slice(1, 3)).map((g) => g.label)).toEqual(['Employees'])
    expect(groupTeammates([])).toEqual([])
  })
})
