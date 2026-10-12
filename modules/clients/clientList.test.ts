import { describe, it, expect } from 'vitest'
import { clientListWhere, compareClientNames, contactName, contactSubline, paginate, parseClientStatus, sortClientsByName } from './clientList'

describe('sortClientsByName', () => {
  it('puts numeric names first, then case-insensitive alphabetical with natural numbers', () => {
    const names = ['beta Co', 'Alpha', '10x Labs', 'a)plan Coaching', '2U', 'Client 10', 'Client 2', 'zeta']
    expect(sortClientsByName(names.map((name) => ({ name }))).map((c) => c.name)).toEqual([
      '2U',
      '10x Labs',
      'a)plan Coaching',
      'Alpha',
      'beta Co',
      'Client 2',
      'Client 10',
      'zeta',
    ])
  })

  it('is deterministic for names equal ignoring case', () => {
    expect(compareClientNames('ACME', 'acme')).not.toBe(0)
    expect(compareClientNames('acme', 'ACME')).toBe(-compareClientNames('ACME', 'acme'))
  })
})

describe('contact display', () => {
  const base = { firstName: 'Lori', lastName: 'Sturdevant', title: null, email: null, phoneOffice: null, phoneMobile: null }

  it('joins title, email and phones with commas, skipping blanks', () => {
    expect(contactSubline({ ...base, title: 'Director of Public Affairs', email: 'lori@example.com', phoneOffice: '612-840-4334' })).toBe(
      'Director of Public Affairs, lori@example.com, 612-840-4334 (office)',
    )
    expect(contactSubline({ ...base, title: '(invoices)', email: 'z@example.com' })).toBe('(invoices), z@example.com')
    expect(contactSubline({ ...base, phoneMobile: '555' })).toBe('555 (mobile)')
    expect(contactSubline({ ...base, title: '  ' })).toBe('')
  })

  it('drops the migrated "—" first-name placeholder', () => {
    expect(contactName({ firstName: '—', lastName: 'Smith' })).toBe('Smith')
    expect(contactName({ firstName: 'Ada', lastName: '' })).toBe('Ada')
    expect(contactName({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada Lovelace')
  })
})

describe('clientListWhere', () => {
  it('always scopes to the account and maps status', () => {
    expect(clientListWhere('acc', 'active', '')).toEqual({ accountId: 'acc', isActive: true })
    expect(clientListWhere('acc', 'archived', '  ')).toEqual({ accountId: 'acc', isActive: false })
    expect(clientListWhere('acc', 'all', '')).toEqual({ accountId: 'acc' })
  })

  it('matches the client name or any contact name/email, contacts scoped to the account', () => {
    const w = clientListWhere('acc', 'active', ' zach ')
    expect(w.accountId).toBe('acc')
    expect(w.isActive).toBe(true)
    const [byName, byContact] = w.OR as any[]
    expect(byName).toEqual({ name: { contains: 'zach', mode: 'insensitive' } })
    expect(byContact.contacts.some.accountId).toBe('acc')
    expect(byContact.contacts.some.OR).toHaveLength(3)
  })

  it('adds a first + last name match for multi-word terms', () => {
    const w = clientListWhere('acc', 'all', 'Zachary Gearon')
    const or = (w.OR as any[])[1].contacts.some.OR
    expect(or[3]).toEqual({
      AND: [{ firstName: { contains: 'Zachary', mode: 'insensitive' } }, { lastName: { contains: 'Gearon', mode: 'insensitive' } }],
    })
  })
})

describe('parseClientStatus / paginate', () => {
  it('defaults unknown status to active', () => {
    expect(parseClientStatus(undefined)).toBe('active')
    expect(parseClientStatus('bogus')).toBe('active')
    expect(parseClientStatus('archived')).toBe('archived')
  })

  it('clamps the page into range', () => {
    const items = Array.from({ length: 250 }, (_, i) => i)
    expect(paginate(items, undefined)).toMatchObject({ page: 1, pages: 3 })
    expect(paginate(items, '3').items).toHaveLength(50)
    expect(paginate(items, '99').page).toBe(3)
    expect(paginate(items, 'x').page).toBe(1)
    expect(paginate([], '2')).toEqual({ items: [], page: 1, pages: 1 })
  })
})
