import { describe, it, expect } from 'vitest'
import { planProjectImport, planUserImport, splitName } from './asanaImport'

describe('asana project import plan', () => {
  it('separates new from already-imported by gid (idempotent)', () => {
    const existing = new Set(['g1'])
    const { toCreate, toUpdate } = planProjectImport(existing, [
      { gid: 'g1', name: 'Existing' },
      { gid: 'g2', name: 'New' },
    ])
    expect(toCreate.map((p) => p.gid)).toEqual(['g2'])
    expect(toUpdate.map((p) => p.gid)).toEqual(['g1'])
  })
})

describe('asana user import plan', () => {
  const existing = [
    { email: 'alice@bigsea.demo', asanaUserGid: 'ag1' },
    { email: 'frank@bigsea.demo', asanaUserGid: null },
  ]

  it('skips users already linked by gid', () => {
    const { toCreate, toLink } = planUserImport(existing, [{ gid: 'ag1', name: 'Alice', email: 'alice@bigsea.demo' }])
    expect(toCreate).toHaveLength(0)
    expect(toLink).toHaveLength(0)
  })

  it('links an existing email that has no gid yet', () => {
    const { toCreate, toLink } = planUserImport(existing, [{ gid: 'ag9', name: 'Frank', email: 'frank@bigsea.demo' }])
    expect(toCreate).toHaveLength(0)
    expect(toLink.map((u) => u.gid)).toEqual(['ag9'])
  })

  it('creates a genuinely new person', () => {
    const { toCreate } = planUserImport(existing, [{ gid: 'ag5', name: 'New Person', email: 'new@x.com' }])
    expect(toCreate.map((u) => u.email)).toEqual(['new@x.com'])
  })
})

describe('splitName', () => {
  it('splits first/last', () => {
    expect(splitName('Ada Lovelace')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' })
    expect(splitName('Cher')).toEqual({ firstName: 'Cher', lastName: '' })
    expect(splitName('Mary Jane Watson')).toEqual({ firstName: 'Mary', lastName: 'Jane Watson' })
  })
})
