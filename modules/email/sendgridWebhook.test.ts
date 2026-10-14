import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import type { InvoiceTraceEvent } from '@/modules/observability/invoiceTrace'
import {
  parsePublicKey,
  verifySendGridSignature,
  mapSendGridEvent,
  handleSendGridWebhook,
  userAgentFamily,
  REPLAY_WINDOW_SECONDS,
} from './sendgridWebhook'

// A throwaway P-256 key pair standing in for SendGrid's signing key.
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const PUBLIC_B64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
const NOW = 1_792_000_000

function signed(body: string, ts = String(NOW)) {
  const signature = sign('sha256', Buffer.from(ts + body), { key: privateKey, dsaEncoding: 'der' }).toString('base64')
  return { rawBody: body, signature, timestamp: ts }
}

describe('verifySendGridSignature', () => {
  const key = parsePublicKey(PUBLIC_B64)!
  const body = JSON.stringify([{ event: 'delivered' }])

  it('accepts a valid signature over timestamp + raw body', () => {
    expect(verifySendGridSignature({ publicKey: key, ...signed(body), nowSeconds: NOW })).toEqual({ ok: true })
  })
  it('accepts a PEM-formatted key too', () => {
    const pem = publicKey.export({ format: 'pem', type: 'spki' }).toString()
    expect(verifySendGridSignature({ publicKey: parsePublicKey(pem)!, ...signed(body), nowSeconds: NOW })).toEqual({ ok: true })
  })
  it('rejects a tampered body', () => {
    const s = signed(body)
    expect(verifySendGridSignature({ publicKey: key, ...s, rawBody: body.replace('delivered', 'bounce'), nowSeconds: NOW })).toEqual({ ok: false, reason: 'bad_signature' })
  })
  it('rejects a signature made with another key', () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const sig = sign('sha256', Buffer.from(String(NOW) + body), other.privateKey).toString('base64')
    expect(verifySendGridSignature({ publicKey: key, rawBody: body, signature: sig, timestamp: String(NOW), nowSeconds: NOW }).ok).toBe(false)
  })
  it('rejects missing headers', () => {
    expect(verifySendGridSignature({ publicKey: key, rawBody: body, signature: null, timestamp: String(NOW), nowSeconds: NOW })).toEqual({ ok: false, reason: 'missing_signature' })
  })
  it('rejects a replay outside the 10-minute window (and a re-signed timestamp swap)', () => {
    const old = signed(body, String(NOW - REPLAY_WINDOW_SECONDS - 1))
    expect(verifySendGridSignature({ publicKey: key, ...old, nowSeconds: NOW })).toEqual({ ok: false, reason: 'stale_timestamp' })
    const s = signed(body, String(NOW - 30))
    expect(verifySendGridSignature({ publicKey: key, ...s, timestamp: String(NOW), nowSeconds: NOW })).toEqual({ ok: false, reason: 'bad_signature' })
  })
  it('garbage key → null', () => {
    expect(parsePublicKey('not a key')).toBeNull()
    expect(parsePublicKey('')).toBeNull()
  })
})

const ev = (over: Record<string, unknown>) => ({
  email: 'ap@client.com',
  timestamp: NOW,
  sg_event_id: 'evt_' + Math.random().toString(36).slice(2),
  sg_message_id: 'msg123.filterdrecv-1.0',
  invoiceId: 'inv_1',
  accountId: 'acc_1',
  traceKind: 'invoice',
  ...over,
})

describe('mapSendGridEvent', () => {
  it.each([
    ['processed', 'email.processed', 'info'],
    ['delivered', 'email.delivered', 'info'],
    ['deferred', 'email.deferred', 'info'],
    ['bounce', 'email.bounced', 'error'],
    ['dropped', 'email.dropped', 'error'],
    ['spamreport', 'email.spam_report', 'error'],
    ['unsubscribe', 'email.unsubscribed', 'warn'],
    ['open', 'email.opened', 'info'],
    ['click', 'email.clicked', 'info'],
  ])('%s → %s (%s)', (event, stage, level) => {
    const m = mapSendGridEvent(ev({ event }))!
    expect(m.stage).toBe(stage)
    expect(m.level).toBe(level)
    expect(m.source).toBe('email')
    expect(m.accountId).toBe('acc_1')
    expect(m.invoiceId).toBe('inv_1')
    expect(m.externalId).toBe('msg123') // correlates with email.accepted's X-Message-Id
    expect(m.occurredAt).toEqual(new Date(NOW * 1000))
  })

  it('uses sg_event_id as the de-dup key', () => {
    expect(mapSendGridEvent(ev({ event: 'delivered', sg_event_id: 'E1' }))!.externalEventId).toBe('E1')
  })

  it('deferred becomes a warning after the 3rd attempt', () => {
    expect(mapSendGridEvent(ev({ event: 'deferred', attempt: '3' }))!.level).toBe('info')
    expect(mapSendGridEvent(ev({ event: 'deferred', attempt: '4' }))!.level).toBe('warn')
  })

  it('bounce keeps the SMTP reason', () => {
    const m = mapSendGridEvent(ev({ event: 'bounce', reason: '550 5.1.1 User unknown', status: '5.1.1', type: 'bounce' }))!
    expect(m.message).toContain('550 5.1.1 User unknown')
    expect(m.detail).toMatchObject({ reason: '550 5.1.1 User unknown', smtpStatus: '5.1.1', bounceType: 'bounce' })
  })

  it('open/click store a user-agent family, never the raw UA or IP', () => {
    const m = mapSendGridEvent(ev({ event: 'open', ip: '1.2.3.4', useragent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' }))!
    expect(m.detail).toMatchObject({ userAgent: 'Safari (mobile)' })
    expect(JSON.stringify(m.detail)).not.toContain('1.2.3.4')
    expect(JSON.stringify(m.detail)).not.toContain('iPhone OS')
  })

  it('ignores events without our custom_args and unknown event types', () => {
    expect(mapSendGridEvent(ev({ event: 'delivered', invoiceId: undefined }))).toBeNull()
    expect(mapSendGridEvent(ev({ event: 'delivered', accountId: '' }))).toBeNull()
    expect(mapSendGridEvent(ev({ event: 'group_resubscribe' }))).toBeNull()
  })
})

describe('userAgentFamily', () => {
  it('classifies coarsely', () => {
    expect(userAgentFamily('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36')).toBe('Chrome (desktop)')
    expect(userAgentFamily('Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)')).toBe('Gmail image proxy')
    expect(userAgentFamily(undefined)).toBe('unknown')
  })
})

describe('handleSendGridWebhook', () => {
  function deps(known = new Set(['acc_1:inv_1'])) {
    const recorded: InvoiceTraceEvent[] = []
    const seen = new Set<string>()
    return {
      recorded,
      deps: {
        invoiceInAccount: async (i: string, a: string) => known.has(`${a}:${i}`),
        record: async (e: InvoiceTraceEvent) => {
          if (e.externalEventId && seen.has(e.externalEventId)) return 'duplicate' as const
          if (e.externalEventId) seen.add(e.externalEventId)
          recorded.push(e)
          return 'recorded' as const
        },
      },
    }
  }

  it('503 and does nothing when the public key is not configured', async () => {
    const d = deps()
    const r = await handleSendGridWebhook(signed('[]'), undefined, d.deps, NOW)
    expect(r.status).toBe(503)
    expect(d.recorded).toHaveLength(0)
  })

  it('401 for unsigned or badly signed requests', async () => {
    const d = deps()
    expect((await handleSendGridWebhook({ rawBody: '[]', signature: null, timestamp: null }, PUBLIC_B64, d.deps, NOW)).status).toBe(401)
    const s = signed('[]')
    expect((await handleSendGridWebhook({ ...s, rawBody: '[{}]' }, PUBLIC_B64, d.deps, NOW)).status).toBe(401)
  })

  it('records mapped events, ignores foreign / unknown ones, and de-dups retries', async () => {
    const d = deps()
    const body = JSON.stringify([
      ev({ event: 'delivered', sg_event_id: 'D1' }),
      ev({ event: 'bounce', sg_event_id: 'B1', reason: 'mailbox full' }),
      ev({ event: 'delivered', sg_event_id: 'X1', accountId: 'acc_other' }), // invoice not in that account
      { event: 'delivered', sg_event_id: 'N1', email: 'team@bigsea.co' }, // not an invoice email
    ])
    const r = await handleSendGridWebhook(signed(body), PUBLIC_B64, d.deps, NOW)
    expect(r).toEqual({ status: 200, body: { recorded: 2, duplicate: 0, ignored: 2, failed: 0 } })
    expect(d.recorded.map((e) => e.stage)).toEqual(['email.delivered', 'email.bounced'])
    const again = await handleSendGridWebhook(signed(body), PUBLIC_B64, d.deps, NOW)
    expect(again.body).toEqual({ recorded: 0, duplicate: 2, ignored: 2, failed: 0 })
  })

  it('400 for a non-array body', async () => {
    expect((await handleSendGridWebhook(signed('{"a":1}'), PUBLIC_B64, deps().deps, NOW)).status).toBe(400)
  })
})
