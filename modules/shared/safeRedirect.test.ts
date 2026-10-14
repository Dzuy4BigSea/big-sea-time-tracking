import { describe, it, expect } from 'vitest'
import { safeCallbackPath } from './safeRedirect'

describe('safeCallbackPath', () => {
  it('keeps local paths with their query', () => {
    expect(safeCallbackPath('/oauth/authorize?client_id=a&state=b')).toBe('/oauth/authorize?client_id=a&state=b')
    expect(safeCallbackPath('/time')).toBe('/time')
  })

  it('falls back for anything off-site', () => {
    for (const bad of [
      'https://evil.com',
      '//evil.com/x',
      '/\\evil.com',
      '\\\\evil.com',
      'javascript:alert(1)',
      'evil.com',
      '/%0d%0aLocation:x'.replace('%0d%0a', '\r\n'),
      '/login',
      '/login?callbackUrl=/x',
      '',
      undefined,
      null,
    ]) {
      expect(safeCallbackPath(bad as string)).toBe('/')
    }
  })

  it('uses the given fallback', () => {
    expect(safeCallbackPath('https://evil.com', '/time')).toBe('/time')
  })
})
