import { describe, it, expect } from 'vitest'
import { pickEntityId, resolveSender, resolveBranding, canSendAs } from './resolveEntity'

describe('pickEntityId', () => {
  it('invoice stamp wins over client and default', () => {
    expect(pickEntityId('inv', 'cli', 'def')).toBe('inv')
  })
  it('falls back to client when invoice unset', () => {
    expect(pickEntityId(null, 'cli', 'def')).toBe('cli')
    expect(pickEntityId(undefined, 'cli', 'def')).toBe('cli')
  })
  it('falls back to default when invoice + client unset', () => {
    expect(pickEntityId(null, null, 'def')).toBe('def')
  })
  it('returns null only when nothing is set', () => {
    expect(pickEntityId(null, null, null)).toBeNull()
  })
})

describe('resolveSender', () => {
  const acct = { senderName: 'Big Sea', senderEmail: 'billing@bigsea.co', replyToEmail: 'hello@bigsea.co' }
  it('uses entity identity when set', () => {
    expect(resolveSender({ senderName: 'Cordelia Labs', senderEmail: 'billing@cordelialabs.com', replyToEmail: null }, acct)).toEqual({
      senderName: 'Cordelia Labs',
      senderEmail: 'billing@cordelialabs.com',
      replyToEmail: 'hello@bigsea.co', // blank entity field falls through
    })
  })
  it('falls through to account default for blank/absent entity fields', () => {
    expect(resolveSender({ senderName: '  ', senderEmail: '' }, acct)).toEqual(acct)
    expect(resolveSender(null, acct)).toEqual(acct)
  })
  it('returns null fields when neither has a value', () => {
    expect(resolveSender(null, {})).toEqual({ senderName: null, senderEmail: null, replyToEmail: null })
  })
})

describe('resolveBranding', () => {
  const appearance = { brandColor: '#004348', accentColor: '#047a44', logoFileUrl: '/brand/bs.png', documentTitle: 'INVOICE' }
  it('entity branding overrides account appearance', () => {
    expect(
      resolveBranding({ brandColor: '#341162', accentColor: '#8a5cf6', logoFileUrl: '/brand/cl.png', documentTitle: 'STATEMENT' }, appearance),
    ).toEqual({
      brandColor: '#341162',
      accentColor: '#8a5cf6',
      logoFileUrl: '/brand/cl.png',
      documentTitle: 'STATEMENT',
    })
  })
  it('blank entity fields fall through to appearance', () => {
    expect(resolveBranding({ brandColor: '', accentColor: '', logoFileUrl: '', documentTitle: null }, appearance)).toEqual(appearance)
    expect(resolveBranding(null, appearance)).toEqual(appearance)
  })
})

describe('canSendAs', () => {
  it('requires a from-address', () => {
    expect(canSendAs({ senderName: 'X', senderEmail: 'x@y.com', replyToEmail: null })).toBe(true)
    expect(canSendAs({ senderName: 'X', senderEmail: null, replyToEmail: null })).toBe(false)
  })
})
