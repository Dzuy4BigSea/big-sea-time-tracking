import { describe, it, expect } from 'vitest'
import { parseSort, nextSort, sortRows } from './sort'

type R = { name: string; hours: number | null }
const rows: R[] = [
  { name: 'beta', hours: 2 },
  { name: 'Alpha', hours: 10 },
  { name: 'gamma', hours: null },
  { name: 'Project 10', hours: 2 },
  { name: 'Project 9', hours: 5 },
]
const acc = { name: (r: R) => r.name, hours: (r: R) => r.hours }

describe('parseSort', () => {
  const fallback = { key: 'hours' as const, dir: 'desc' as const }
  it('accepts allowed keys and directions', () => {
    expect(parseSort({ sort: 'name', dir: 'asc' }, ['name', 'hours'] as const, fallback)).toEqual({ key: 'name', dir: 'asc' })
  })
  it('falls back on unknown keys', () => {
    expect(parseSort({ sort: 'evil', dir: 'asc' }, ['name', 'hours'] as const, fallback)).toEqual(fallback)
  })
  it('uses the fallback direction when dir is invalid', () => {
    expect(parseSort({ sort: 'name', dir: 'up' }, ['name', 'hours'] as const, fallback)).toEqual({ key: 'name', dir: 'desc' })
  })
})

describe('nextSort', () => {
  it('flips the active column', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name', 'asc')).toEqual({ key: 'name', dir: 'desc' })
    expect(nextSort({ key: 'name', dir: 'desc' }, 'name', 'asc')).toEqual({ key: 'name', dir: 'asc' })
  })
  it('starts a new column at its first direction', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'hours', 'desc')).toEqual({ key: 'hours', dir: 'desc' })
  })
})

describe('sortRows', () => {
  it('sorts text case-insensitively with natural numbers', () => {
    expect(sortRows(rows, { key: 'name', dir: 'asc' }, acc).map((r) => r.name)).toEqual(['Alpha', 'beta', 'gamma', 'Project 9', 'Project 10'])
  })
  it('sorts numbers descending, keeping ties stable and blanks last', () => {
    expect(sortRows(rows, { key: 'hours', dir: 'desc' }, acc).map((r) => r.name)).toEqual(['Alpha', 'Project 9', 'beta', 'Project 10', 'gamma'])
  })
  it('keeps blanks last when ascending too', () => {
    expect(sortRows(rows, { key: 'hours', dir: 'asc' }, acc).map((r) => r.name)).toEqual(['beta', 'Project 10', 'Project 9', 'Alpha', 'gamma'])
  })
  it('does not mutate the input', () => {
    const copy = [...rows]
    sortRows(rows, { key: 'name', dir: 'desc' }, acc)
    expect(rows).toEqual(copy)
  })
})
