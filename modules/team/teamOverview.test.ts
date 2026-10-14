import { describe, expect, it } from 'vitest'
import {
  archiveError,
  assignableToManager,
  canHoldAssignedPeople,
  cleanAssignIds,
  parseTeamFilter,
  pinnedFirst,
  teamFilterOptions,
  teamFilterValue,
} from './teamOverview'

describe('parseTeamFilter (AC-TEAM-004, AC-TEAM-021)', () => {
  it('defaults to everyone without assigned people', () => {
    expect(parseTeamFilter('', { hasAssignedPeople: false })).toEqual({ kind: 'everyone' })
    expect(parseTeamFilter(undefined, { hasAssignedPeople: false })).toEqual({ kind: 'everyone' })
  })
  it('defaults a manager with assigned people to their assigned people, with an explicit Everyone', () => {
    expect(parseTeamFilter('', { hasAssignedPeople: true })).toEqual({ kind: 'assigned' })
    expect(parseTeamFilter('everyone', { hasAssignedPeople: true })).toEqual({ kind: 'everyone' })
  })
  it('ignores "assigned" for someone with no assigned people', () => {
    expect(parseTeamFilter('assigned', { hasAssignedPeople: false })).toEqual({ kind: 'everyone' })
  })
  it('parses pins, types, roles and access levels; junk falls back to everyone', () => {
    const o = { hasAssignedPeople: false }
    expect(parseTeamFilter('pins', o)).toEqual({ kind: 'pins' })
    expect(parseTeamFilter('type:contractor', o)).toEqual({ kind: 'type', type: 'contractor' })
    expect(parseTeamFilter('type:robot', o)).toEqual({ kind: 'everyone' })
    expect(parseTeamFilter('role:Design', o)).toEqual({ kind: 'role', role: 'Design' })
    expect(parseTeamFilter('role:', o)).toEqual({ kind: 'everyone' })
    expect(parseTeamFilter('administrator', o)).toEqual({ kind: 'profile', profile: 'administrator' })
    expect(parseTeamFilter('owner', o)).toEqual({ kind: 'everyone' })
  })
  it('round-trips through teamFilterValue', () => {
    for (const has of [true, false]) {
      for (const raw of ['', 'everyone', 'pins', 'type:employee', 'role:Dev', 'accounting']) {
        const f = parseTeamFilter(raw, { hasAssignedPeople: has })
        expect(parseTeamFilter(teamFilterValue(f, { hasAssignedPeople: has }), { hasAssignedPeople: has })).toEqual(f)
      }
    }
  })
})

describe('teamFilterOptions (AC-TEAM-003)', () => {
  const labels = { member: 'Member', administrator: 'Administrator' }
  it('puts Everyone first and My pins next', () => {
    const o = teamFilterOptions({ hasAssignedPeople: false, roles: [], profileLabels: labels })
    expect(o.slice(0, 2).map((x) => [x.value, x.label])).toEqual([['', 'Everyone'], ['pins', 'My pins']])
  })
  it('offers My assigned people as the default for a manager with assignments', () => {
    const o = teamFilterOptions({ hasAssignedPeople: true, roles: [], profileLabels: labels })
    expect(o.slice(0, 3).map((x) => x.label)).toEqual(['My assigned people', 'Everyone', 'My pins'])
    expect(o[0].value).toBe('')
  })
  it('lists distinct roles alphabetically', () => {
    const o = teamFilterOptions({ hasAssignedPeople: false, roles: ['Dev', 'Design', 'Dev', ' '], profileLabels: {} })
    expect(o.filter((x) => x.group === 'Roles').map((x) => x.label)).toEqual(['Design', 'Dev'])
  })
})

describe('pinnedFirst (AC-TEAM-006)', () => {
  it('moves pinned rows to the top, keeping order', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    expect(pinnedFirst(rows, new Set(['d', 'b'])).map((r) => r.id)).toEqual(['b', 'd', 'a', 'c'])
  })
})

describe('assigned people (AC-TEAM-030..033)', () => {
  it('only Project Managers hold assigned people', () => {
    expect(canHoldAssignedPeople('project_manager')).toBe(true)
    for (const p of ['member', 'administrator', 'people_admin', 'accounting', 'executive_manager']) expect(canHoldAssignedPeople(p)).toBe(false)
  })
  it('offers active people other than the manager who are not yet assigned', () => {
    const people = [
      { id: 'm', name: 'Manager', isActive: true },
      { id: 'z', name: 'Zed', isActive: true },
      { id: 'a', name: 'Amy', isActive: true },
      { id: 'x', name: 'Gone', isActive: false },
      { id: 'b', name: 'Bo', isActive: true },
    ]
    expect(assignableToManager(people, 'm', new Set(['b'])).map((p) => p.id)).toEqual(['a', 'z'])
  })
  it('cleans submitted ids: comma lists, blanks, dupes, self and foreign ids dropped', () => {
    expect(cleanAssignIds(['a,b', 'b', '', 'm', 'other-account'], 'm', new Set(['a', 'b', 'm']))).toEqual(['a', 'b'])
  })
})

describe('archiveError (AC-TEAM-008)', () => {
  it('blocks self and the account owner', () => {
    expect(archiveError({ actorId: 'u', targetId: 'u', accountOwnerId: null })).toMatch(/yourself/)
    expect(archiveError({ actorId: 'u', targetId: 'o', accountOwnerId: 'o' })).toMatch(/owner/)
    expect(archiveError({ actorId: 'u', targetId: 'v', accountOwnerId: 'o' })).toBeNull()
  })
})
