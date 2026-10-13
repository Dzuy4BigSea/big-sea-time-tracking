import { describe, it, expect } from 'vitest'
import { resolveAppUrl } from './appUrl'

describe('resolveAppUrl', () => {
  it('prefers APP_URL, then AUTH_URL, then NEXTAUTH_URL (origin only)', () => {
    expect(resolveAppUrl({ APP_URL: 'https://track2.example.com/', AUTH_URL: 'https://a.example.com' })).toBe('https://track2.example.com')
    expect(resolveAppUrl({ AUTH_URL: 'https://a.example.com/api/auth' })).toBe('https://a.example.com')
    expect(resolveAppUrl({ NEXTAUTH_URL: 'http://localhost:3001' })).toBe('http://localhost:3001')
  })

  it('falls back to the Vercel production domain, then localhost', () => {
    expect(resolveAppUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'track2.example.com' })).toBe('https://track2.example.com')
    expect(resolveAppUrl({})).toBe('http://localhost:3000')
  })

  it('ignores junk values', () => {
    expect(resolveAppUrl({ APP_URL: 'not a url', AUTH_URL: 'javascript:alert(1)', NEXTAUTH_URL: 'https://ok.example.com' })).toBe('https://ok.example.com')
  })
})
