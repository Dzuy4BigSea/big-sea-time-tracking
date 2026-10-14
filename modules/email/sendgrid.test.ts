import { describe, it, expect } from 'vitest'
import {
  buildSendGridPayload,
  cleanSubject,
  normalizeRecipients,
  parseSendGridResponse,
  baseMessageId,
  foreignLinkHosts,
  publicLinkProblem,
} from './sendgrid'

const base = {
  to: ['ap@client.com', 'cfo@client.com'],
  from: { email: 'billing@bigsea.co', name: 'Big Sea' },
  replyTo: 'hello@bigsea.co',
  subject: 'Invoice 1042 from Big Sea',
  html: '<p>Hi</p>',
  text: 'Hi',
  customArgs: { invoiceId: 'inv_1', accountId: 'acc_1', traceKind: 'invoice' },
  categories: ['track2', 'invoice-invoice'],
}

describe('buildSendGridPayload', () => {
  const p = buildSendGridPayload(base) as Record<string, any>

  it('sends a text/plain alternative first, then HTML', () => {
    expect(p.content.map((c: { type: string }) => c.type)).toEqual(['text/plain', 'text/html'])
    expect(p.content[0].value).toBe('Hi')
  })

  it('addresses every recipient, from + reply-to', () => {
    expect(p.personalizations[0].to).toEqual([{ email: 'ap@client.com' }, { email: 'cfo@client.com' }])
    expect(p.from).toEqual({ email: 'billing@bigsea.co', name: 'Big Sea' })
    expect(p.reply_to).toEqual({ email: 'hello@bigsea.co' })
  })

  it('carries custom_args for webhook correlation (all strings) and categories', () => {
    expect(p.personalizations[0].custom_args).toEqual({ invoiceId: 'inv_1', accountId: 'acc_1', traceKind: 'invoice' })
    expect(Object.values(p.personalizations[0].custom_args).every((v) => typeof v === 'string')).toBe(true)
    expect(p.categories).toEqual(['track2', 'invoice-invoice'])
  })

  it('disables click tracking (no link rewriting) and subscription footer; keeps open tracking', () => {
    expect(p.tracking_settings.click_tracking).toEqual({ enable: false, enable_text: false })
    expect(p.tracking_settings.subscription_tracking).toEqual({ enable: false })
    expect(p.tracking_settings.open_tracking).toEqual({ enable: true })
  })

  it('adds no List-Unsubscribe (transactional mail)', () => {
    expect(JSON.stringify(p)).not.toMatch(/unsubscribe/i)
    expect(p.headers).toBeUndefined()
  })

  it('omits reply_to / custom_args when absent', () => {
    const q = buildSendGridPayload({ ...base, replyTo: null, customArgs: undefined, categories: undefined }) as Record<string, any>
    expect(q.reply_to).toBeUndefined()
    expect(q.personalizations[0].custom_args).toBeUndefined()
    expect(q.categories).toBeUndefined()
  })
})

describe('cleanSubject', () => {
  it('strips CR/LF (header injection) and squashes whitespace', () => {
    expect(cleanSubject('Invoice 1\r\nBcc: x@y.com')).toBe('Invoice 1 Bcc: x@y.com')
    expect(cleanSubject('  a   b  ')).toBe('a b')
  })
})

describe('normalizeRecipients', () => {
  it('drops blanks and junk and de-duplicates case-insensitively', () => {
    expect(normalizeRecipients(['A@x.com', null, '', 'a@X.com', 'not-an-email', 'b@y.org ', 'x@y.com, z@w.com'])).toEqual(['A@x.com', 'b@y.org'])
  })
})

describe('parseSendGridResponse', () => {
  const h = (m: Record<string, string>) => ({ get: (n: string) => m[n.toLowerCase()] ?? null })
  it('202 → ok with X-Message-Id', () => {
    expect(parseSendGridResponse(202, h({ 'x-message-id': 'abc123' }), '')).toEqual({ ok: true, httpStatus: 202, messageId: 'abc123', error: null })
  })
  it('4xx → error summary from SendGrid errors[]', () => {
    const r = parseSendGridResponse(403, h({}), JSON.stringify({ errors: [{ message: 'The from address does not match a verified Sender Identity', field: 'from' }] }))
    expect(r.ok).toBe(false)
    expect(r.httpStatus).toBe(403)
    expect(r.error).toBe('from: The from address does not match a verified Sender Identity')
  })
  it('non-JSON body is trimmed', () => {
    expect(parseSendGridResponse(500, h({}), 'x'.repeat(900)).error).toHaveLength(500)
  })
})

describe('baseMessageId', () => {
  it('takes the X-Message-Id prefix of sg_message_id', () => {
    expect(baseMessageId('14c5d75ce93.dfd.64b469.filter0001.16648.5515E0B88.0')).toBe('14c5d75ce93')
    expect(baseMessageId(undefined)).toBeNull()
  })
})

describe('foreignLinkHosts', () => {
  it('lists link hosts outside the allowed set', () => {
    const html = '<a href="https://track2.bigseabridge.com/i/abc">x</a><a href="https://bit.ly/zz">y</a><a href="mailto:a@b.c">m</a>'
    expect(foreignLinkHosts(html, ['track2.bigseabridge.com'])).toEqual(['bit.ly'])
  })
})

describe('publicLinkProblem', () => {
  it('refuses localhost / http only in production', () => {
    expect(publicLinkProblem('http://localhost:3000', { NODE_ENV: 'development' })).toBeNull()
    expect(publicLinkProblem('http://localhost:3000', { VERCEL_ENV: 'production' })).toMatch(/https/)
    expect(publicLinkProblem('https://localhost', { VERCEL_ENV: 'production' })).toMatch(/localhost/)
    expect(publicLinkProblem('https://track2.bigseabridge.com', { VERCEL_ENV: 'production' })).toBeNull()
  })
})
