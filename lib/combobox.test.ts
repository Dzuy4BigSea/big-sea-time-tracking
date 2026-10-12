import { describe, it, expect } from 'vitest'
import { filterOptions, groupOptions, type ComboOption } from './combobox'

const opts: ComboOption[] = [
  { value: 'p1', label: 'Website Redesign', group: 'Acme Co', keywords: 'ACM-01' },
  { value: 'p2', label: 'SEO Retainer', group: 'Acme Co' },
  { value: 'p3', label: 'Website Redesign', group: 'Café Nova' },
  { value: 'p4', label: 'Internal', group: 'Big Sea' },
  { value: 'c1', label: 'Travel' },
]

describe('filterOptions', () => {
  it('returns everything for a blank query', () => {
    expect(filterOptions(opts, '   ')).toHaveLength(opts.length)
  })
  it('matches the label case-insensitively', () => {
    expect(filterOptions(opts, 'seo').map((o) => o.value)).toEqual(['p2'])
  })
  it('matches the group so typing a client shows its projects', () => {
    expect(filterOptions(opts, 'acme').map((o) => o.value)).toEqual(['p1', 'p2'])
  })
  it('requires every term, across label and group', () => {
    expect(filterOptions(opts, 'acme web').map((o) => o.value)).toEqual(['p1'])
  })
  it('matches hidden keywords and ignores accents', () => {
    expect(filterOptions(opts, 'acm-01').map((o) => o.value)).toEqual(['p1'])
    expect(filterOptions(opts, 'cafe').map((o) => o.value)).toEqual(['p3'])
  })
  it('returns nothing when no option matches', () => {
    expect(filterOptions(opts, 'zzz')).toEqual([])
  })
})

describe('groupOptions', () => {
  it('sections options by group in first-seen order', () => {
    const s = groupOptions(opts)
    expect(s.map((x) => x.group)).toEqual(['Acme Co', 'Café Nova', 'Big Sea', null])
    expect(s[0].options.map((o) => o.value)).toEqual(['p1', 'p2'])
  })
  it('merges non-adjacent options of the same group', () => {
    const s = groupOptions([
      { value: 'a', label: 'A', group: 'X' },
      { value: 'b', label: 'B', group: 'Y' },
      { value: 'c', label: 'C', group: 'X' },
    ])
    expect(s.map((x) => [x.group, x.options.map((o) => o.value)])).toEqual([
      ['X', ['a', 'c']],
      ['Y', ['b']],
    ])
  })
})
