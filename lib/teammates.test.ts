import { describe, it, expect } from 'vitest'
import { filterPeople, timesheetHrefFor } from './teammates'

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
})
