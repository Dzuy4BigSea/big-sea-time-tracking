import { describe, it, expect } from 'vitest'
import {
  checkSendgrid, checkStripe, checkXero, internalChecks, alertsDue, alertEmail, checkKey, getJson, summarizeResults,
  isTrack2StripeWebhookUrl, STRIPE_REQUIRED_EVENTS, type FetchLike, type CheckResult,
} from './healthChecks'

const APP = 'https://track2.bigseabridge.com'
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Route-table fetch mock: first matching prefix wins. Records every call. */
function mockFetch(routes: Array<[string, () => Response | Promise<Response>]>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init })
    const hit = routes.find(([p]) => url.startsWith(p))
    if (!hit) throw new TypeError('fetch failed')
    return hit[1]()
  }
  return { f, calls }
}
const ctx = { entityId: 'ent_1', entity: 'Big Sea' }

describe('getJson', () => {
  it('times out a hung request', async () => {
    const hang: FetchLike = (_u, init) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    const r = await getJson(hang, 'https://x', {}, 20)
    expect(r).toMatchObject({ status: null, error: 'timeout' })
  })
  it('network error', async () => {
    const r = await getJson(async () => { throw new TypeError('fetch failed') }, 'https://x', {})
    expect(r.error).toBe('network')
  })
  it('uses GET only', async () => {
    const { f, calls } = mockFetch([['https://x', () => json(200, {})]])
    await getJson(f, 'https://x', {})
    expect(calls[0].init?.method).toBe('GET')
  })
})

describe('checkSendgrid', () => {
  const healthy = (): Array<[string, () => Response | Promise<Response>]> => [
    ['https://api.sendgrid.com/v3/scopes', () => json(200, { scopes: ['mail.send', 'user.webhooks.event.settings.read', 'whitelabel.read'] })],
    ['https://api.sendgrid.com/v3/user/webhooks/event/settings', () => json(200, { enabled: true, url: `${APP}/api/email/events`, delivered: true, bounce: true, dropped: true, spam_report: true, open: true, processed: true })],
    ['https://api.sendgrid.com/v3/whitelabel/domains', () => json(200, [{ id: 1, domain: 'bigsea.co', subdomain: 'em1234', valid: true }])],
  ]
  const input = { apiKey: 'SG.secret-value', appUrl: APP, senderEmails: ['billing@bigsea.co'], ...ctx }

  it('all green', async () => {
    const { f, calls } = mockFetch(healthy())
    const r = await checkSendgrid(f, input)
    expect(r.map((x) => [x.check, x.level])).toEqual([['sendgrid.api_key', 'info'], ['sendgrid.event_webhook', 'info'], ['sendgrid.domain', 'info']])
    expect(calls.every((c) => c.init?.method === 'GET')).toBe(true)
    // the key is only ever in the Authorization header, never in a result
    expect(JSON.stringify(r)).not.toContain('SG.secret-value')
  })
  it('401 on scopes → single error, stops', async () => {
    const { f, calls } = mockFetch([['https://api.sendgrid.com/v3/scopes', () => json(401, { errors: [{ message: 'authorization required' }] })]])
    const r = await checkSendgrid(f, input)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ check: 'sendgrid.api_key', level: 'error', ok: false })
    expect(r[0].message).toContain('401')
    expect(calls).toHaveLength(1)
  })
  it('no mail.send scope → error', async () => {
    const routes = healthy()
    routes[0] = ['https://api.sendgrid.com/v3/scopes', () => json(200, { scopes: ['stats.read'] })]
    const r = await checkSendgrid(mockFetch(routes).f, input)
    expect(r[0]).toMatchObject({ level: 'error', message: expect.stringContaining('mail.send') })
  })
  it('webhook 403 (key without read scope) → error with guidance', async () => {
    const routes = healthy()
    routes[1] = ['https://api.sendgrid.com/v3/user/webhooks/event/settings', () => json(403, { errors: [{ message: 'access forbidden' }] })]
    const r = await checkSendgrid(mockFetch(routes).f, input)
    expect(r[1]).toMatchObject({ check: 'sendgrid.event_webhook', level: 'error' })
    expect(r[1].message).toContain('verify it by hand')
  })
  it('webhook disabled / wrong URL / missing events', async () => {
    const run = async (body: object) => (await checkSendgrid(mockFetch([healthy()[0], ['https://api.sendgrid.com/v3/user/webhooks/event/settings', () => json(200, body)], healthy()[2]]).f, input))[1]
    expect((await run({ enabled: false, url: `${APP}/api/email/events` })).level).toBe('error')
    expect((await run({ enabled: true, url: 'https://old.example.com/hook', delivered: true, bounce: true, dropped: true, spam_report: true })).message).toContain('expected')
    const m = await run({ enabled: true, url: `${APP}/api/email/events?token=x`, delivered: true, bounce: false, dropped: true, spam_report: true, open: true })
    expect(m).toMatchObject({ level: 'warn', details: expect.objectContaining({ missingEvents: ['bounce'] }) })
    expect((await run({ enabled: true, url: `${APP}/api/email/events`, delivered: true, bounce: true, dropped: true, spam_report: true, open: false })).level).toBe('warn')
  })
  it('sending domain not authenticated', async () => {
    const routes = healthy()
    routes[2] = ['https://api.sendgrid.com/v3/whitelabel/domains', () => json(200, [{ domain: 'bigsea.co', valid: false }])]
    const r = await checkSendgrid(mockFetch(routes).f, { ...input, senderEmails: ['billing@bigsea.co', 'ap@other.com'] })
    expect(r[2].level).toBe('error')
    expect(r[2].message).toContain('bigsea.co (DNS not valid)')
    expect(r[2].message).toContain('other.com (not set up)')
  })
  it('subdomain sender matches its root authenticated domain', async () => {
    const r = await checkSendgrid(mockFetch(healthy()).f, { ...input, senderEmails: ['x@mail.bigsea.co'] })
    expect(r[2].level).toBe('info')
  })
  it('timeout on the domains call', async () => {
    const routes = healthy()
    routes[2] = ['https://api.sendgrid.com/v3/whitelabel/domains', () => new Promise<Response>(() => {})]
    const r = await checkSendgrid(mockFetch(routes).f, input, 20)
    expect(r[2]).toMatchObject({ level: 'error', message: expect.stringContaining('no response') })
  })
})

describe('checkStripe', () => {
  const allEvents = [...STRIPE_REQUIRED_EVENTS]
  const hook = (over: object = {}) => ({ id: 'we_1', url: `${APP}/api/integrations/stripe/webhook/acc_1`, status: 'enabled', enabled_events: allEvents, ...over })
  const routes = (endpoints: object[], account: object = { id: 'acct_1', charges_enabled: true, payouts_enabled: true }): Array<[string, () => Response | Promise<Response>]> => [
    ['https://api.stripe.com/v1/account', () => json(200, account)],
    ['https://api.stripe.com/v1/webhook_endpoints', () => json(200, { object: 'list', data: endpoints, has_more: false })],
  ]
  const input = { secretKey: 'sk_live_abc', appUrl: APP, accountId: 'acc_1', expectLive: true, ...ctx }

  it('healthy', async () => {
    const r = await checkStripe(mockFetch(routes([hook()])).f, input)
    expect(r.map((x) => x.level)).toEqual(['info', 'info'])
    expect(r[0].details).toMatchObject({ livemode: true })
    expect(JSON.stringify(r)).not.toContain('sk_live_abc')
  })
  it('401 → one error', async () => {
    const r = await checkStripe(mockFetch([['https://api.stripe.com/v1/account', () => json(401, { error: { message: 'Invalid API Key provided: sk_live_***abc' } })]]).f, input)
    expect(r).toEqual([expect.objectContaining({ check: 'stripe.account', level: 'error' })])
  })
  it('restricted key 403 on webhook_endpoints', async () => {
    const r = await checkStripe(mockFetch([routes([])[0], ['https://api.stripe.com/v1/webhook_endpoints', () => json(403, { error: { type: 'invalid_request_error' } })]]).f, input)
    expect(r[1]).toMatchObject({ check: 'stripe.webhook', level: 'error', message: expect.stringContaining('403') })
  })
  it('charges disabled → error; test key in prod → warn', async () => {
    expect((await checkStripe(mockFetch(routes([hook()], { charges_enabled: false })).f, input))[0].level).toBe('error')
    expect((await checkStripe(mockFetch(routes([hook()])).f, { ...input, secretKey: 'sk_test_1' }))[0].level).toBe('warn')
  })
  it('no endpoint for our app → error; other apps ignored', async () => {
    const r = await checkStripe(mockFetch(routes([hook({ url: 'https://other.app/api/stripe/webhook' })])).f, input)
    expect(r[1]).toMatchObject({ level: 'error', message: expect.stringContaining('No Stripe webhook') })
  })
  it('disabled endpoint → error', async () => {
    expect((await checkStripe(mockFetch(routes([hook({ status: 'disabled' })])).f, input))[1].message).toContain('disabled')
  })
  it('missing critical event → error, missing others → warn, * → ok', async () => {
    const noCheckout = allEvents.filter((e) => e !== 'checkout.session.completed')
    expect((await checkStripe(mockFetch(routes([hook({ enabled_events: noCheckout })])).f, input))[1].level).toBe('error')
    expect((await checkStripe(mockFetch(routes([hook({ enabled_events: ['checkout.session.completed'] })])).f, input))[1].level).toBe('warn')
    expect((await checkStripe(mockFetch(routes([hook({ enabled_events: ['*'] })])).f, input))[1].level).toBe('info')
  })
  it('isTrack2StripeWebhookUrl', () => {
    expect(isTrack2StripeWebhookUrl(`${APP}/api/stripe/webhook`, APP, 'acc_1')).toBe(true)
    expect(isTrack2StripeWebhookUrl(`${APP}/api/integrations/stripe/webhook/acc_2`, APP, 'acc_1')).toBe(false)
    expect(isTrack2StripeWebhookUrl(`${APP}.evil.com/api/stripe/webhook`, APP, 'acc_1')).toBe(false)
  })
})

describe('checkXero', () => {
  const input = { accessToken: 'tok', tenantId: 'ten_1', hasRefreshToken: true, ...ctx }
  const ok = (): Array<[string, () => Response | Promise<Response>]> => [
    ['https://api.xero.com/connections', () => json(200, [{ id: 'c1', tenantId: 'ten_1', tenantType: 'ORGANISATION', tenantName: 'Big Sea' }])],
    ['https://api.xero.com/api.xro/2.0/Organisation', () => json(200, { Organisations: [{ Name: 'Big Sea', OrganisationStatus: 'ACTIVE' }] })],
  ]
  it('healthy, sends the tenant header on Organisation', async () => {
    const { f, calls } = mockFetch(ok())
    const r = await checkXero(f, input)
    expect(r.map((x) => x.level)).toEqual(['info', 'info'])
    expect((calls[1].init?.headers as Record<string, string>)['xero-tenant-id']).toBe('ten_1')
  })
  it('expired token (401) → error with reconnect hint', async () => {
    const r = await checkXero(mockFetch([['https://api.xero.com/connections', () => json(401, { Title: 'Unauthorized', Detail: 'TokenExpired' })]]).f, input)
    expect(r).toHaveLength(1)
    expect(r[0].message).toContain('reconnect')
  })
  it('tenant missing', async () => {
    const r = await checkXero(mockFetch([['https://api.xero.com/connections', () => json(200, [{ tenantId: 'other' }])]]).f, input)
    expect(r[0]).toMatchObject({ level: 'error', message: expect.stringContaining('tenant') })
  })
  it('organisation 403 / 500', async () => {
    expect((await checkXero(mockFetch([ok()[0], ['https://api.xero.com/api.xro', () => json(403, {})]]).f, input))[1].level).toBe('error')
    expect((await checkXero(mockFetch([ok()[0], ['https://api.xero.com/api.xro', () => json(503, {})]]).f, input))[1].level).toBe('warn')
  })
})

describe('internalChecks', () => {
  const now = new Date('2026-10-14T12:00:00Z')
  it('all clear', () => {
    expect(internalChecks({ errors24h: 0, undelivered: [], unsyncedPayments: null }, now).every((r) => r.ok)).toBe(true)
  })
  it('levels', () => {
    const r = internalChecks({
      errors24h: 3,
      undelivered: [{ invoiceId: 'i1', number: '7801', sentAt: new Date('2026-10-10T12:00:00Z') }],
      unsyncedPayments: [{ invoiceId: 'i2', paymentId: 'p2', number: '7802' }],
    }, now)
    expect(r.map((x) => [x.check, x.level])).toEqual([['internal.errors_24h', 'warn'], ['internal.undelivered', 'error'], ['internal.xero_payments', 'error']])
  })
  it('recent undelivered is a warning, many errors is an error', () => {
    const r = internalChecks({ errors24h: 12, undelivered: [{ invoiceId: 'i1', number: null, sentAt: new Date('2026-10-13T06:00:00Z') }], unsyncedPayments: [] }, now)
    expect(r.map((x) => x.level)).toEqual(['error', 'warn', 'info'])
  })
})

describe('alertsDue (once per 24h per check)', () => {
  const now = new Date('2026-10-14T12:00:00Z')
  const err = (check: string, entityId: string | null = null): CheckResult => ({ provider: 'stripe', check, entityId, entity: null, ok: false, level: 'error', message: 'x' })
  it('first error alerts; warnings never do', () => {
    expect(alertsDue([err('stripe.webhook'), { ...err('stripe.account'), level: 'warn' }], new Map(), now).map((r) => r.check)).toEqual(['stripe.webhook'])
  })
  it('suppressed within 24h of the last alert, per entity', () => {
    const last = new Map([[checkKey(err('stripe.webhook', 'e1')), new Date('2026-10-14T01:00:00Z')]])
    expect(alertsDue([err('stripe.webhook', 'e1'), err('stripe.webhook', 'e2')], last, now).map((r) => r.entityId)).toEqual(['e2'])
  })
  it('alerts again after 24h', () => {
    const last = new Map([[checkKey(err('stripe.webhook')), new Date('2026-10-13T12:00:00Z')]])
    expect(alertsDue([err('stripe.webhook')], last, now)).toHaveLength(1)
  })
  it('alert email escapes provider text', () => {
    const m = alertEmail('Big Sea', [{ ...err('xero.connection'), message: '<script>x</script>' }], `${APP}/settings/activity-log`)
    expect(m.html).not.toContain('<script>')
    expect(m.subject).toContain('1 problem')
  })
})

it('summarizeResults', () => {
  const r = (level: 'info' | 'warn' | 'error'): CheckResult => ({ provider: 'internal', check: 'c', entityId: null, entity: null, ok: level === 'info', level, message: '' })
  expect(summarizeResults([r('info'), r('warn'), r('error'), r('error')])).toEqual({ total: 4, ok: 1, warn: 1, error: 2 })
})

