import { describe, it, expect, beforeEach } from 'vitest'
import { FakeXero } from '@/test/xeroFake'
import { XeroSession, syncInvoiceWithSession, pickXeroConnection, type InvoiceForXero, type XeroConnectionInfo, type XeroSyncRepo, type XeroTraceInput } from './xeroSyncCore'
import type { XeroTokenSet, XeroTokenState, XeroTokenStore } from './xeroAuth'
import type { XeroHttpDeps } from './xeroClient'

const NOW = Date.parse('2026-10-14T15:00:00Z')

/** In-memory persistence: tokens (with a real mutex), links, traces, sync log. */
class MemRepo implements XeroSyncRepo {
  traces: XeroTraceInput[] = []
  logs: Array<{ entityType: string; entityId: string; externalId?: string | null; ok: boolean; message?: string | null }> = []
  contactIds = new Map<string, string>()
  invoiceLinks = new Map<string, string>()
  paymentLinks = new Map<string, string>()
  stored: XeroTokenState
  reconnectReason: string | null = null
  private lock: Promise<unknown> = Promise.resolve()
  constructor(initial: XeroTokenState) {
    this.stored = { ...initial }
  }
  async saveContactId(clientId: string, contactId: string) {
    this.contactIds.set(clientId, contactId)
  }
  async linkInvoice(invoiceId: string, x: string) {
    this.invoiceLinks.set(invoiceId, x)
  }
  async linkPayment(paymentId: string, x: string) {
    this.paymentLinks.set(paymentId, x)
  }
  async logSync(e: MemRepo['logs'][number]) {
    this.logs.push(e)
  }
  async trace(e: XeroTraceInput) {
    this.traces.push(e)
  }
  tokenStore(): XeroTokenStore {
    return {
      withRefreshLock: <T,>(fn: (cur: XeroTokenState, save: (t: XeroTokenSet) => Promise<void>) => Promise<T>) => {
        const run = this.lock.then(() => fn({ ...this.stored }, async (t) => void (this.stored = { ...t, status: 'connected' })))
        this.lock = run.catch(() => {})
        return run
      },
      markNeedsReconnect: async (reason: string) => {
        this.reconnectReason = reason
        this.stored.status = 'error'
      },
    }
  }
  stages() {
    return this.traces.map((t) => t.stage)
  }
}

function conn(over: Partial<XeroConnectionInfo> = {}): XeroConnectionInfo {
  return {
    id: 'conn-bs',
    entityId: 'ent-bs',
    tenantId: 'tenant-bigsea',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    tokens: { accessToken: 'at-0', refreshToken: 'rt-0', expiresAt: new Date(NOW + 20 * 60_000), status: 'connected' },
    defaultRevenueAccountCode: '400.2',
    paymentAccountCode: 'Stripe',
    salesTaxAccountCode: '820',
    populateTrackingByClient: false,
    cutoff: new Date('2026-10-01T00:00:00Z'),
    ...over,
  }
}

function invoice(over: Partial<InvoiceForXero> = {}): InvoiceForXero {
  // 10h × $160 + 0.33h × $150 = $1,649.50; 10% discount −$164.95; 8% tax on the discounted base $118.76
  return {
    id: 'inv-1',
    number: '8001',
    status: 'open',
    currency: 'USD',
    issueDate: new Date('2026-10-14T00:00:00Z'),
    dueDate: new Date('2026-11-13T00:00:00Z'),
    sentAt: new Date('2026-10-14T14:00:00Z'),
    createdAt: new Date('2026-10-13T14:00:00Z'),
    xeroInvoiceId: null,
    poNumber: null,
    totalCents: 164950 - 16495 + 11876,
    discountCents: 16495,
    discountPercent: 10,
    taxCents: 11876,
    tax1Name: 'Sales tax',
    tax1Percent: 8,
    tax2Name: null,
    tax2Percent: null,
    harvestOrigin: false,
    client: { id: 'cl-1', name: 'Acme Corp', xeroContactId: null, contactMappingTrusted: true, emails: ['ap@acme.test'] },
    lineItems: [
      { description: 'Design', quantity: 10, unitPriceCents: 16000, amountCents: 160000, taxable: true },
      { description: 'QA', quantity: 0.33, unitPriceCents: 15000, amountCents: 4950, taxable: true },
    ],
    payments: [],
    ...over,
  }
}

let xero: FakeXero
let repo: MemRepo
let sleeps: number[]
const deps = (): XeroHttpDeps => ({ fetch: xero.fetch as typeof fetch, sleep: async (ms) => void sleeps.push(ms), now: () => NOW, timeoutMs: 30 })
const session = (c = conn()) => new XeroSession(repo, c, deps())

beforeEach(() => {
  xero = new FakeXero()
  repo = new MemRepo(conn().tokens)
  sleeps = []
})

describe('invoice → Xero', () => {
  it('happy path: creates the contact and an AUTHORISED invoice whose Xero total equals Track2', async () => {
    const inv = invoice()
    const out = await syncInvoiceWithSession(session(), inv)
    expect(out.result).toBe('synced')
    expect(xero.invoices).toHaveLength(1)
    const x = xero.invoices[0]
    expect(x).toMatchObject({ InvoiceNumber: '8001', Status: 'AUTHORISED', CurrencyCode: 'USD', Date: '2026-10-14', DueDate: '2026-11-13', LineAmountTypes: 'NoTax' })
    expect(Math.round(x.Total * 100)).toBe(inv.totalCents)
    expect(x.LineItems.map((l: any) => l.AccountCode)).toEqual(['400.2', '400.2', '400.2', '820'])
    const put = xero.callsTo('PUT', '/Invoices')[0]
    expect(put.headers['idempotency-key']).toMatch(/^track2-invoice-inv-1-[0-9a-f]{16}$/)
    expect(put.headers['xero-tenant-id']).toBe('tenant-bigsea')
    expect(repo.invoiceLinks.get('inv-1')).toBe(x.InvoiceID)
    expect(repo.contactIds.get('cl-1')).toBe(xero.contacts[0].ContactID)
    expect(repo.stages()).toEqual(['xero.invoice_sync_started', 'xero.invoice_synced'])
    const synced = repo.traces[1]
    expect(synced.externalId).toBe(x.InvoiceID)
    expect(synced.detail).toMatchObject({ xeroTotalCents: inv.totalCents, track2TotalCents: inv.totalCents })
    expect(repo.logs.filter((l) => l.entityType === 'invoice')).toEqual([expect.objectContaining({ ok: true, externalId: x.InvoiceID })])
  })

  it('idempotent re-run: a linked invoice is fetched and compared, never created again', async () => {
    const inv = invoice()
    await syncInvoiceWithSession(session(), inv)
    const again = await syncInvoiceWithSession(session(), { ...invoice(), xeroInvoiceId: repo.invoiceLinks.get('inv-1')!, client: { ...inv.client, xeroContactId: repo.contactIds.get('cl-1')! } })
    expect(again.result).toBe('unchanged')
    expect(xero.callsTo('PUT', '/Invoices')).toHaveLength(1)
    expect(xero.invoices).toHaveLength(1)
  })

  it('a linked invoice whose Track2 total changed is updated in place (POST with InvoiceID) while unpaid in Xero', async () => {
    await syncInvoiceWithSession(session(), invoice())
    const id = repo.invoiceLinks.get('inv-1')!
    const edited = invoice({ xeroInvoiceId: id, lineItems: [{ description: 'Design', quantity: 10, unitPriceCents: 16000, amountCents: 160000, taxable: false }], discountCents: 0, discountPercent: null, taxCents: 0, totalCents: 160000 })
    const out = await syncInvoiceWithSession(session(), edited)
    expect(out.result).toBe('updated')
    expect(xero.invoices).toHaveLength(1)
    expect(xero.invoices[0].Total).toBe(1600)
  })

  it('reuses an existing Xero contact matched by name, then by email (no duplicate contact)', async () => {
    xero.contacts.push({ ContactID: 'c-existing', Name: 'ACME corp', EmailAddress: '', ContactStatus: 'ACTIVE' })
    await syncInvoiceWithSession(session(), invoice())
    expect(xero.callsTo('PUT', '/Contacts')).toHaveLength(0)
    expect(xero.invoices[0].Contact.ContactID).toBe('c-existing')

    xero = new FakeXero()
    repo = new MemRepo(conn().tokens)
    xero.contacts.push({ ContactID: 'c-by-mail', Name: 'Acme Corporation LLC', EmailAddress: 'AP@acme.test', ContactStatus: 'ACTIVE' })
    await syncInvoiceWithSession(session(), invoice())
    expect(xero.callsTo('PUT', '/Contacts')).toHaveLength(0)
    expect(xero.invoices[0].Contact.ContactID).toBe('c-by-mail')
  })

  it('does not trust a stored contact id from another entity’s Xero org (and does not overwrite it)', async () => {
    const inv = invoice({ client: { id: 'cl-1', name: 'Acme Corp', xeroContactId: 'contact-in-other-org', contactMappingTrusted: false, emails: [] } })
    const out = await syncInvoiceWithSession(session(), inv)
    expect(out.result).toBe('synced')
    expect(xero.invoices[0].Contact.ContactID).not.toBe('contact-in-other-org')
    expect(repo.contactIds.size).toBe(0)
  })

  it('timeout after Xero applied the create: looks up by InvoiceNumber and links — one invoice in Xero', async () => {
    xero.failNext('PUT', '/Invoices', { kind: 'timeout', applyFirst: true })
    const out = await syncInvoiceWithSession(session(), invoice())
    expect(out.result).toBe('synced')
    expect(xero.invoices).toHaveLength(1)
    expect(xero.callsTo('PUT', '/Invoices')).toHaveLength(1) // no blind retry
    expect(repo.invoiceLinks.get('inv-1')).toBe(xero.invoices[0].InvoiceID)
    expect(repo.traces.find((t) => t.stage === 'xero.error')?.level).toBe('warn')
  })

  it('timeout before Xero applied it: look-up finds nothing, the create is retried with the same Idempotency-Key', async () => {
    xero.failNext('PUT', '/Invoices', { kind: 'timeout' })
    const out = await syncInvoiceWithSession(session(), invoice())
    expect(out.result).toBe('synced')
    const puts = xero.callsTo('PUT', '/Invoices')
    expect(puts).toHaveLength(2)
    expect(new Set(puts.map((p) => p.headers['idempotency-key'])).size).toBe(1)
    expect(xero.invoices).toHaveLength(1)
  })

  it('an invoice already in Xero under the same number (lost response / earlier run) is linked, not duplicated', async () => {
    await syncInvoiceWithSession(session(), invoice())
    repo.invoiceLinks.clear()
    const out = await syncInvoiceWithSession(session(), invoice())
    expect(out.result).toBe('linked')
    expect(xero.invoices).toHaveLength(1)
  })

  it('429: waits Retry-After, retries, and traces xero.rate_limited (warn)', async () => {
    xero.failNext('PUT', '/Invoices', { kind: '429', retryAfter: '3' })
    const out = await syncInvoiceWithSession(session(), invoice())
    expect(out.result).toBe('synced')
    expect(sleeps).toContain(3000)
    const rl = repo.traces.find((t) => t.stage === 'xero.rate_limited')!
    expect(rl.level).toBe('warn')
    expect(rl.detail).toMatchObject({ retryAfterSec: 3, willRetry: true })
  })

  it('validation error: traced with Xero’s messages, logged, not linked, and retryable later', async () => {
    const out = await syncInvoiceWithSession(session(conn({ defaultRevenueAccountCode: '999' })), invoice())
    expect(out.result).toBe('failed')
    const v = repo.traces.find((t) => t.stage === 'xero.validation_error')!
    expect(v.level).toBe('error')
    expect((v.detail as any).messages).toContain("Account code '999' is not a valid code for this document.")
    expect(repo.invoiceLinks.size).toBe(0)
    expect(repo.logs.at(-1)).toMatchObject({ entityType: 'invoice', entityId: 'inv-1', ok: false })
    // fixed config → the retry creates it once
    expect((await syncInvoiceWithSession(session(), invoice())).result).toBe('synced')
    expect(xero.invoices).toHaveLength(1)
  })

  it('total mismatch after create: error trace with both totals, Xero id still stored (no re-create)', async () => {
    xero.totalSkew = 0.01
    const out = await syncInvoiceWithSession(session(), invoice())
    expect(out.result).toBe('failed')
    const m = repo.traces.find((t) => t.stage === 'xero.invoice_total_mismatch')!
    expect(m.level).toBe('error')
    expect(m.detail).toMatchObject({ xeroTotalCents: invoice().totalCents + 1, track2TotalCents: invoice().totalCents })
    expect(repo.invoiceLinks.get('inv-1')).toBe(xero.invoices[0].InvoiceID)
  })

  it('pre-flight: lines that would not add up to the Track2 total are never sent', async () => {
    const out = await syncInvoiceWithSession(session(), invoice({ totalCents: 1 }))
    expect(out.result).toBe('failed')
    expect(xero.callsTo('PUT', '/Invoices')).toHaveLength(0)
    expect(repo.traces.find((t) => t.stage === 'xero.invoice_total_mismatch')?.detail).toMatchObject({ preflight: true })
  })

  it('go-live rule: Harvest-imported or pre-cutover invoices are linked by number only, never created', async () => {
    const h = await syncInvoiceWithSession(session(), invoice({ harvestOrigin: true }))
    expect(h.result).toBe('skipped')
    const old = await syncInvoiceWithSession(session(), invoice({ sentAt: new Date('2026-09-30T12:00:00Z') }))
    expect(old.result).toBe('skipped')
    expect(xero.callsTo('PUT', '/Invoices')).toHaveLength(0)
    expect(repo.stages().filter((s) => s === 'xero.skipped')).toHaveLength(2)
    // Harvest already copied it → found by number → linked
    xero.contacts.push({ ContactID: 'c-h', Name: 'Acme Corp', ContactStatus: 'ACTIVE' })
    xero.invoices.push({ InvoiceID: 'x-harvest', Type: 'ACCREC', InvoiceNumber: '8001', Status: 'AUTHORISED', Total: invoice().totalCents / 100, AmountDue: invoice().totalCents / 100, AmountPaid: 0, AmountCredited: 0, CurrencyCode: 'USD', Payments: [] })
    const linked = await syncInvoiceWithSession(session(), invoice({ harvestOrigin: true }))
    expect(linked.result).toBe('linked')
    expect(repo.invoiceLinks.get('inv-1')).toBe('x-harvest')
  })

  it('drafts are never copied', async () => {
    const out = await syncInvoiceWithSession(session(), invoice({ status: 'draft' }))
    expect(out.result).toBe('skipped')
    expect(xero.calls).toHaveLength(0)
  })
})

describe('auth', () => {
  it('expired access token: refreshes before the call, saves the rotated refresh token, traces token_refreshed', async () => {
    const c = conn({ tokens: { accessToken: 'stale', refreshToken: 'rt-0', expiresAt: new Date(NOW + 30_000), status: 'connected' } })
    repo = new MemRepo(c.tokens)
    const out = await syncInvoiceWithSession(session(c), invoice())
    expect(out.result).toBe('synced')
    expect(xero.tokenCalls).toBe(1)
    expect(repo.stored).toMatchObject({ accessToken: 'at-1', refreshToken: 'rt-1', status: 'connected' })
    expect(repo.stored.expiresAt!.getTime()).toBe(NOW + 1800_000)
    expect(repo.stages()).toContain('xero.token_refreshed')
    const tokenReq = xero.calls.find((r) => r.body?.grant_type === 'refresh_token')!
    expect(tokenReq.headers.authorization).toBe(`Basic ${Buffer.from('client-id:client-secret').toString('base64')}`)
  })

  it('401 mid-flight (unknown expiry): refresh once and retry once', async () => {
    const c = conn({ tokens: { accessToken: 'revoked', refreshToken: 'rt-0', expiresAt: null, status: 'connected' } })
    repo = new MemRepo(c.tokens)
    expect((await syncInvoiceWithSession(session(c), invoice())).result).toBe('synced')
    expect(xero.tokenCalls).toBe(1)
  })

  it('invalid_grant: marks the connection needs-reconnect, traces auth_failed once, and never loops', async () => {
    const c = conn({ tokens: { accessToken: 'stale', refreshToken: 'rt-old', expiresAt: new Date(NOW - 1000), status: 'connected' } })
    repo = new MemRepo(c.tokens)
    const s = session(c)
    const out = await syncInvoiceWithSession(s, invoice())
    expect(out.result).toBe('failed')
    expect(repo.reconnectReason).toMatch(/invalid_grant/)
    expect(repo.stored.status).toBe('error')
    expect(repo.traces.filter((t) => t.stage === 'xero.auth_failed')).toHaveLength(1)
    expect(repo.traces.find((t) => t.stage === 'xero.auth_failed')!.level).toBe('error')
    expect(repo.logs.at(-1)).toMatchObject({ ok: false })
    // the next invoice in the same run fails fast: no more token calls, no API calls
    const before = xero.calls.length
    expect((await syncInvoiceWithSession(s, invoice({ id: 'inv-2', number: '8002' }))).result).toBe('failed')
    expect(xero.calls.length).toBe(before)
    expect(s.halted).toBe('auth')
  })

  it('a token that no longer reaches the tenant (Connections API) needs a reconnect', async () => {
    xero.connectedTenants = ['some-other-tenant']
    const c = conn({ tokens: { accessToken: 'stale', refreshToken: 'rt-0', expiresAt: new Date(NOW - 1000), status: 'connected' } })
    repo = new MemRepo(c.tokens)
    const out = await syncInvoiceWithSession(session(c), invoice())
    expect(out.result).toBe('failed')
    expect(repo.reconnectReason).toMatch(/no longer connected/)
  })

  it('concurrent refresh: two requests with the same expired token spend the refresh token once', async () => {
    const c = conn({ tokens: { accessToken: 'stale', refreshToken: 'rt-0', expiresAt: new Date(NOW - 1000), status: 'connected' } })
    repo = new MemRepo(c.tokens)
    const a = session(c)
    const b = session(c)
    const [ta, tb] = await Promise.all([a.tokens.get(), b.tokens.get()])
    expect(ta).toBe('at-1')
    expect(tb).toBe('at-1')
    expect(xero.tokenCalls).toBe(1)
    expect(repo.stored.refreshToken).toBe('rt-1')
  })

  it('Custom Connection (no refresh token): mints an access token with client_credentials', async () => {
    const c = conn({ tokens: { accessToken: null, refreshToken: null, expiresAt: null, status: 'connected' } })
    repo = new MemRepo(c.tokens)
    expect((await syncInvoiceWithSession(session(c), invoice())).result).toBe('synced')
    expect(xero.calls.find((r) => r.url.includes('identity.xero.com'))?.body).toEqual({ grant_type: 'client_credentials' })
    expect(repo.stored).toMatchObject({ accessToken: 'at-cc-1', refreshToken: null })
  })

  it('a connection already flagged needs-reconnect fails fast with auth_failed (no Xero calls)', async () => {
    const c = conn({ tokens: { ...conn().tokens, status: 'error' } })
    const out = await syncInvoiceWithSession(session(c), invoice())
    expect(out.result).toBe('failed')
    expect(xero.calls).toHaveLength(0)
    expect(repo.stages()).toContain('xero.auth_failed')
  })
})

describe('payments → Xero', () => {
  const pay = (id: string, cents: number, over: Partial<InvoiceForXero['payments'][number]> = {}) => ({
    id,
    amountCents: cents,
    paidOn: new Date('2026-10-15T00:00:00Z'),
    note: 'Paid online via Stripe',
    xeroPaymentId: null,
    createdAt: new Date('2026-10-15T10:00:00Z'),
    harvestOrigin: false,
    ...over,
  })

  it('payment before the invoice exists in Xero: creates the invoice, then the payment', async () => {
    const inv = invoice({ status: 'paid', payments: [pay('pay-1', invoice().totalCents)] })
    const out = await syncInvoiceWithSession(session(), inv)
    expect(out.result).toBe('synced')
    expect(out.payments).toEqual([expect.objectContaining({ paymentId: 'pay-1', result: 'synced' })])
    const putPay = xero.callsTo('PUT', '/Payments')[0]
    expect(putPay.headers['idempotency-key']).toMatch(/^track2-payment-pay-1-[0-9a-f]{16}$/)
    expect(putPay.body.Payments[0]).toMatchObject({ Account: { Code: 'Stripe' }, Amount: invoice().totalCents / 100, Date: '2026-10-15' })
    expect(putPay.body.Payments[0].Reference).toContain('T2:pay-1')
    expect(xero.invoices[0].Status).toBe('PAID')
    expect(repo.paymentLinks.get('pay-1')).toBe(xero.invoices[0].Payments[0].PaymentID)
    const ev = repo.traces.find((t) => t.stage === 'xero.payment_synced')!
    expect(ev).toMatchObject({ paymentId: 'pay-1', externalId: xero.invoices[0].Payments[0].PaymentID, level: 'info' })
    // the sync-log row names the payment, not the invoice
    expect(repo.logs.find((l) => l.entityType === 'payment')).toMatchObject({ entityId: 'pay-1', ok: true })
  })

  it('duplicate protection: a payment already in Xero (lost response) is linked by its T2 marker, not re-created', async () => {
    await syncInvoiceWithSession(session(), invoice({ payments: [pay('pay-1', 5000)] }))
    expect(xero.callsTo('PUT', '/Payments')).toHaveLength(1)
    repo.paymentLinks.clear()
    const out = await syncInvoiceWithSession(session(), invoice({ xeroInvoiceId: repo.invoiceLinks.get('inv-1')!, payments: [pay('pay-1', 5000)] }))
    expect(out.payments[0].result).toBe('linked')
    expect(xero.callsTo('PUT', '/Payments')).toHaveLength(1)
    expect(xero.invoices[0].Payments).toHaveLength(1)
  })

  it('re-running after success makes no payment call at all', async () => {
    await syncInvoiceWithSession(session(), invoice({ payments: [pay('pay-1', 5000)] }))
    const x = repo.invoiceLinks.get('inv-1')!
    await syncInvoiceWithSession(session(), invoice({ xeroInvoiceId: x, payments: [pay('pay-1', 5000, { xeroPaymentId: repo.paymentLinks.get('pay-1')! })] }))
    expect(xero.callsTo('PUT', '/Payments')).toHaveLength(1)
  })

  it('payment create times out after Xero applied it: found on the invoice by marker → linked once', async () => {
    xero.failNext('PUT', '/Payments', { kind: 'timeout', applyFirst: true })
    const out = await syncInvoiceWithSession(session(), invoice({ payments: [pay('pay-1', 5000)] }))
    expect(out.payments[0].result).toBe('synced')
    expect(xero.invoices[0].Payments).toHaveLength(1)
  })

  it('partial payments: each copied once, in date order, Xero amount due tracks Track2 balance', async () => {
    const inv = invoice({
      payments: [pay('pay-2', 20000, { paidOn: new Date('2026-10-20T00:00:00Z') }), pay('pay-1', 10000, { note: null })],
    })
    const out = await syncInvoiceWithSession(session(), inv)
    expect(out.payments.map((p) => [p.paymentId, p.result])).toEqual([
      ['pay-1', 'synced'],
      ['pay-2', 'synced'],
    ])
    expect(Math.round(xero.invoices[0].AmountDue * 100)).toBe(inv.totalCents - 30000)
    expect(xero.invoices[0].Status).toBe('AUTHORISED')
  })

  it('overpayment: copies only the amount due and flags the excess (warn + sync-log failure)', async () => {
    const total = invoice().totalCents
    const out = await syncInvoiceWithSession(session(), invoice({ payments: [pay('pay-1', total + 2500)] }))
    expect(out.payments[0].result).toBe('synced')
    expect(xero.callsTo('PUT', '/Payments')[0].body.Payments[0].Amount).toBe(total / 100)
    const ev = repo.traces.find((t) => t.stage === 'xero.payment_synced')!
    expect(ev.level).toBe('warn')
    expect(ev.detail).toMatchObject({ overpaymentCents: 2500 })
    expect(repo.logs.some((l) => l.entityType === 'payment' && !l.ok && /Overpayment/.test(l.message ?? ''))).toBe(true)
  })

  it('no payment account configured → payments skipped (“do not copy payments”)', async () => {
    const out = await syncInvoiceWithSession(session(conn({ paymentAccountCode: null })), invoice({ payments: [pay('pay-1', 5000)] }))
    expect(out.payments[0].result).toBe('skipped')
    expect(xero.callsTo('PUT', '/Payments')).toHaveLength(0)
  })

  it('a bad payment account is a validation error on that payment; the invoice stays synced', async () => {
    const out = await syncInvoiceWithSession(session(conn({ paymentAccountCode: 'Nope' })), invoice({ payments: [pay('pay-1', 5000)] }))
    expect(out.result).toBe('synced')
    expect(out.payments[0].result).toBe('failed')
    const v = repo.traces.find((t) => t.stage === 'xero.validation_error')!
    expect(v.paymentId).toBe('pay-1')
    expect(repo.paymentLinks.size).toBe(0)
  })

  it('Harvest-imported payments are never copied (Harvest did)', async () => {
    const out = await syncInvoiceWithSession(session(), invoice({ payments: [pay('pay-h', 5000, { harvestOrigin: true })] }))
    expect(out.payments[0].result).toBe('skipped')
    expect(xero.callsTo('PUT', '/Payments')).toHaveLength(0)
  })
})

describe('tenant routing per entity (AC-ENT-007)', () => {
  const rows = [
    { id: 'shared', entityId: null },
    { id: 'bs', entityId: 'ent-bs' },
  ]
  it('uses the entity’s own connection', () => {
    expect(pickXeroConnection(rows, 'ent-bs', 'ent-bs')?.id).toBe('bs')
  })
  it('falls back to the legacy shared row only for the default entity', () => {
    expect(pickXeroConnection([{ id: 'shared', entityId: null }], 'ent-bs', 'ent-bs')?.id).toBe('shared')
    expect(pickXeroConnection([{ id: 'shared', entityId: null }], null, null)?.id).toBe('shared')
  })
  it('never routes Cordelia’s invoice to another org', () => {
    expect(pickXeroConnection(rows, 'ent-cl', 'ent-bs')).toBeNull()
  })
})
