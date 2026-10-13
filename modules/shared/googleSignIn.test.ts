import { describe, it, expect } from 'vitest'
import {
  checkGoogleProfile,
  googleRefusalPath,
  isGoogleConfigured,
  loginErrorMessage,
  matchGoogleUser,
  normalizeEmail,
  parseAllowedDomains,
} from './googleSignIn'

describe('googleSignIn', () => {
  it('is configured only when both id and secret are set', () => {
    expect(isGoogleConfigured({})).toBe(false)
    expect(isGoogleConfigured({ AUTH_GOOGLE_ID: 'id' })).toBe(false)
    expect(isGoogleConfigured({ AUTH_GOOGLE_ID: 'id', AUTH_GOOGLE_SECRET: '  ' })).toBe(false)
    expect(isGoogleConfigured({ AUTH_GOOGLE_ID: 'id', AUTH_GOOGLE_SECRET: 's' })).toBe(true)
  })

  it('parses allowed domains with a bigsea.co default', () => {
    expect(parseAllowedDomains(undefined)).toEqual(['bigsea.co'])
    expect(parseAllowedDomains(' , ')).toEqual(['bigsea.co'])
    expect(parseAllowedDomains(' BigSea.co, @cordelialabs.com ,bigsea.co')).toEqual(['bigsea.co', 'cordelialabs.com'])
  })

  it('normalizes emails', () => {
    expect(normalizeEmail('  Dzuy@BigSea.CO ')).toBe('dzuy@bigsea.co')
    expect(normalizeEmail(undefined)).toBe('')
    expect(normalizeEmail(42)).toBe('')
  })

  describe('checkGoogleProfile', () => {
    const allowed = ['bigsea.co']
    it('accepts a verified Workspace address in an allowed domain', () => {
      expect(checkGoogleProfile({ email: 'Dzuy@BigSea.co', email_verified: true, hd: 'bigsea.co' }, allowed)).toEqual({
        ok: true,
        email: 'dzuy@bigsea.co',
      })
    })
    it('refuses unverified or missing email', () => {
      expect(checkGoogleProfile({ email: 'a@bigsea.co', email_verified: false, hd: 'bigsea.co' }, allowed)).toEqual({ ok: false, reason: 'unverified' })
      expect(checkGoogleProfile({ email: 'a@bigsea.co', email_verified: 'true', hd: 'bigsea.co' }, allowed)).toEqual({ ok: false, reason: 'unverified' })
      expect(checkGoogleProfile({ email_verified: true, hd: 'bigsea.co' }, allowed)).toEqual({ ok: false, reason: 'unverified' })
      expect(checkGoogleProfile(null, allowed)).toEqual({ ok: false, reason: 'unverified' })
    })
    it('refuses personal accounts (no hd) and other Workspaces', () => {
      expect(checkGoogleProfile({ email: 'a@gmail.com', email_verified: true }, allowed)).toEqual({ ok: false, reason: 'domain' })
      expect(checkGoogleProfile({ email: 'a@bigsea.co', email_verified: true }, allowed)).toEqual({ ok: false, reason: 'domain' })
      expect(checkGoogleProfile({ email: 'a@evil.com', email_verified: true, hd: 'evil.com' }, allowed)).toEqual({ ok: false, reason: 'domain' })
    })
    it('requires both hd and the email domain to be allowed', () => {
      expect(checkGoogleProfile({ email: 'a@evil.com', email_verified: true, hd: 'bigsea.co' }, allowed)).toEqual({ ok: false, reason: 'domain' })
      expect(checkGoogleProfile({ email: 'a@bigsea.co', email_verified: true, hd: 'evil.com' }, allowed)).toEqual({ ok: false, reason: 'domain' })
      expect(checkGoogleProfile({ email: 'a@bigsea.co.evil.com', email_verified: true, hd: 'bigsea.co' }, allowed)).toEqual({ ok: false, reason: 'domain' })
      expect(checkGoogleProfile({ email: 'a@x.com', email_verified: true, hd: 'bigsea.co' }, ['bigsea.co', 'x.com']).ok).toBe(true)
    })
  })

  describe('matchGoogleUser', () => {
    const u = (id: string, accountId: string, isActive = true) => ({ id, accountId, isActive })
    it('matches the single active user', () => {
      expect(matchGoogleUser([u('u1', 'acc')])).toEqual({ ok: true, user: u('u1', 'acc') })
    })
    it('refuses unknown emails (never auto-creates)', () => {
      expect(matchGoogleUser([])).toEqual({ ok: false, reason: 'no_user' })
    })
    it('refuses inactive users', () => {
      expect(matchGoogleUser([u('u1', 'acc', false)])).toEqual({ ok: false, reason: 'inactive' })
    })
    it('refuses an email present in more than one account, active or not', () => {
      expect(matchGoogleUser([u('u1', 'a'), u('u2', 'b')])).toEqual({ ok: false, reason: 'ambiguous' })
      expect(matchGoogleUser([u('u1', 'a'), u('u2', 'b', false)])).toEqual({ ok: false, reason: 'ambiguous' })
    })
    it('refuses two active rows in one account', () => {
      expect(matchGoogleUser([u('u1', 'a'), u('u2', 'a')])).toEqual({ ok: false, reason: 'ambiguous' })
    })
  })

  it('maps refusals to /login error codes and friendly messages', () => {
    expect(googleRefusalPath('no_user')).toBe('/login?error=GoogleNoUser')
    expect(googleRefusalPath('domain')).toBe('/login?error=GoogleNotWorkspace')
    expect(loginErrorMessage(null)).toBeNull()
    expect(loginErrorMessage('AccessDenied')).toMatch(/Big Sea Google Workspace/)
    expect(loginErrorMessage('GoogleInactive')).toMatch(/deactivated/)
    expect(loginErrorMessage('GoogleNoUser')).toMatch(/no Track2 user/)
    expect(loginErrorMessage('Configuration')).toMatch(/didn’t complete/)
  })
})
