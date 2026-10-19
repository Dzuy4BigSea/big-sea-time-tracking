import { describe, it, expect } from 'vitest'
import { asanaTaskUrl, fromHarvestReference, normalizeService, safePermalink } from './externalRef'

describe('normalizeService', () => {
  it('maps every Asana spelling to "asana"', () => {
    expect(normalizeService('app.asana.com')).toBe('asana')
    expect(normalizeService('https://app.asana.com')).toBe('asana')
    expect(normalizeService('Asana')).toBe('asana')
  })
  it('keeps other services, lower-cased; empty → null', () => {
    expect(normalizeService('GitHub.com')).toBe('github.com')
    expect(normalizeService('')).toBeNull()
    expect(normalizeService(null)).toBeNull()
  })
  it('does not treat look-alike hosts as Asana', () => {
    expect(normalizeService('notasana.com')).toBe('notasana.com')
  })
})

describe('fromHarvestReference (AC-ASANAAPP-010)', () => {
  it('maps a Harvest Asana reference', () => {
    expect(
      fromHarvestReference({
        id: '1205000000000001',
        group_id: '1204000000000009',
        account_id: '1100',
        permalink: 'https://app.asana.com/0/1204000000000009/1205000000000001',
        service: 'app.asana.com',
        service_icon_url: 'https://…',
      }),
    ).toEqual({
      externalService: 'asana',
      externalId: '1205000000000001',
      externalGroupId: '1204000000000009',
      externalPermalink: 'https://app.asana.com/0/1204000000000009/1205000000000001',
    })
  })
  it('accepts numeric ids and a missing group', () => {
    expect(fromHarvestReference({ id: 42, service: 'app.asana.com' })).toEqual({
      externalService: 'asana', externalId: '42', externalGroupId: null, externalPermalink: null,
    })
  })
  it('infers Asana from the permalink when service is blank', () => {
    expect(fromHarvestReference({ id: '7', permalink: 'https://app.asana.com/0/1/7' })?.externalService).toBe('asana')
  })
  it('returns null for no reference, no id, or no service', () => {
    expect(fromHarvestReference(null)).toBeNull()
    expect(fromHarvestReference({})).toBeNull()
    expect(fromHarvestReference({ service: 'app.asana.com' })).toBeNull()
    expect(fromHarvestReference({ id: '7' })).toBeNull()
  })
  it('drops non-http permalinks', () => {
    expect(fromHarvestReference({ id: '7', service: 'asana', permalink: 'javascript:alert(1)' })?.externalPermalink).toBeNull()
  })
})

describe('helpers', () => {
  it('safePermalink only allows http(s)', () => {
    expect(safePermalink('https://app.asana.com/0/1/2')).toBe('https://app.asana.com/0/1/2')
    expect(safePermalink('ftp://x')).toBeNull()
    expect(safePermalink('not a url')).toBeNull()
  })
  it('asanaTaskUrl', () => {
    expect(asanaTaskUrl('2', '1')).toBe('https://app.asana.com/0/1/2')
    expect(asanaTaskUrl('2')).toBe('https://app.asana.com/0/0/2')
  })
})
