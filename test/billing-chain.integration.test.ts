/**
 * The whole billing chain against a live (throwaway) DB, with the three providers faked at fetch:
 *
 *   send (SendGrid 202) + copy to Xero → signed SendGrid delivered/open events (real route)
 *   → client opens /i/<token> → signed Stripe checkout.session.completed (real route)
 *   → payment recorded + receipt emailed + payment copied to Xero
 *
 * then every provider retry is replayed and must change nothing: no second payment, no second Xero
 * invoice or payment, no duplicate trace rows. Finally a Stripe outage in Xero's leg is shown to be
 * recoverable: the payment stays recorded, the trail says why, and syncPendingXero finishes the job.
 *
 * Creates its own client/invoice/connections in acc_globex and removes them after.
 * Run with: npm run test:integration (needs DATABASE_URL to a disposable database).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createHmac, generateKeyPairSync, sign, randomBytes } from 'node:crypto'
import { FakeXero } from './xeroFake'

vi.mock('server-only', () => ({}))
const reqHeaders = new Map<string, string>()
vi.mock('next/headers', () => ({
  headers: () => ({ get: (k: string) => reqHeaders.get(k.toLowerCase()) ?? null, has: (k: string) => reqHeaders.has(k.toLowerCase()) }),
  cookies: () => ({ get: () => undefined }),
}))
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => null, requireUser: async () => { throw new Error('no session in tests') } }))
process.env.INTEGRATION_ENC_KEY ??= 'integration-test-key-0123456789'

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')

const { prisma } = await import('@/lib/prisma')
const { encryptSecret } = await import('@/lib/crypto')
const { emailInvoiceToClient } = await import('@/modules/email/invoiceEmails')
const { syncInvoiceToXero, syncPendingXero } = await import('@/modules/integrations/xeroSync')
const { recordInvoiceView } = await import('@/modules/invoicing/recordInvoiceView')
const { summarizeInvoiceTrace } = await import('@/modules/observability/invoiceTraceSummary')
const { POST: sendgridEvents } = await import('@/app/api/email/events/route')
const { POST: stripeWebhook } = await import('@/app/api/integrations/stripe/webhook/[accountId]/route')

const ACC = 'acc_globex'
const tag = randomBytes(4).toString('hex')
const WHSEC = `whsec_${tag}`
const BASE = 'https://track2.example.com'
const ids = { client: '', invoice: '', invoice2: '', conns: [] as string[] }

// --- provider fakes -----------------------------------------------------------------------------
const xero = new FakeXero()
const sendgrid: Array<{ to: string[]; subject: string; customArgs: Record<string, string> }> = []
let sgSeq = 0
async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input)
  if (url.startsWith('https://api.sendgrid.com/')) {
    const b = JSON.parse(String(init.body))
    sendgrid.push({ to: b.personalizations[0].to.map((t: { email: string }) => t.email), subject: b.subject, customArgs: b.personalizations[0].custom_args })
    return new Response(null, { status: 202, headers: { 'X-Message-Id': `SG${tag}-${++sgSeq}` } })
  }
  return xero.fetch(input, init)
}

function sendgridPost(events: unknown[]) {
  const body = JSON.stringify(events)
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = sign('sha256', Buffer.from(ts + body), privateKey).toString('base64')
  return sendgridEvents(
    new Request(`${BASE}/api/email/events`, {
      method: 'POST',
      body,
      headers: { 'x-twilio-email-event-webhook-signature': sig, 'x-twilio-email-event-webhook-timestamp': ts },
    }),
  )
}

function stripePost(event: object, secret = WHSEC) {
  const body = JSON.stringify(event)
  const t = Math.floor(Date.now() / 1000)
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  return stripeWebhook(new Request(`${BASE}/api/integrations/stripe/webhook/${ACC}`, { method: 'POST', body, headers: { 'stripe-signature': `t=${t},v1=${v1}` } }), {
    params: { accountId: ACC },
  })
}
const checkoutCompleted = (invoiceId: string, pi: string, cents: number) => ({
  id: `evt_${pi}`,
  object: 'event',
  type: 'checkout.session.completed',
  created: Math.floor(Date.now() / 1000) - 5,
  livemode: false,
  data: {
    object: {
      id: `cs_${pi}`,
      object: 'checkout.session',
      payment_intent: pi,
      payment_status: 'paid',
      status: 'complete',
      amount_total: cents,
      currency: 'usd',
      payment_method_types: ['card'],
      metadata: { invoiceId, accountId: ACC },
    },
  },
})

const trail = (invoiceId: string) =>
  prisma.invoiceEvent.findMany({ where: { accountId: ACC, invoiceId }, orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] })
const stages = async (invoiceId: string) => (await trail(invoiceId)).map((e) => e.stage)
const count = (xs: string[], s: string) => xs.filter((x) => x === s).length

async function makeInvoice(number: string, cents: number) {
  const inv = await prisma.invoice.create({
    data: {
      accountId: ACC,
      clientId: ids.client,
      status: 'open',
      number,
      currency: 'USD',
      issueDate: new Date(),
      sentAt: new Date(),
      dueDate: new Date(Date.now() + 30 * 86400_000),
      totalCents: cents,
      publicToken: randomBytes(24).toString('hex'),
      lineItems: { create: [{ accountId: ACC, description: 'Design sprint', quantity: 1, unitPriceCents: cents, amountCents: cents, taxable: false }] },
    },
  })
  return inv
}

beforeAll(async () => {
  const taken = await prisma.integrationConnection.findFirst({ where: { accountId: ACC, provider: { in: ['sendgrid', 'stripe', 'xero'] } } })
  if (taken) throw new Error(`acc_globex already has a ${taken.provider} connection; refusing to touch it`)
  const client = await prisma.client.create({
    data: {
      accountId: ACC,
      name: `Chain Test ${tag}`,
      contacts: { create: [{ accountId: ACC, firstName: 'Ann', lastName: 'Payable', email: `ap-${tag}@example.com`, isInvoiceRecipient: true }] },
    },
  })
  ids.client = client.id
  ids.invoice = (await makeInvoice(`C-${tag}`, 150000)).id
  ids.invoice2 = (await makeInvoice(`C2-${tag}`, 42000)).id

  const conns = await Promise.all([
    prisma.integrationConnection.create({
      data: { accountId: ACC, provider: 'sendgrid', status: 'connected', secretsEnc: { apiKey: encryptSecret('SG.test') }, config: { fromEmail: 'billing@bigsea.co', fromName: 'Big Sea' } },
    }),
    prisma.integrationConnection.create({
      data: { accountId: ACC, provider: 'stripe', status: 'connected', secretsEnc: { secretKey: encryptSecret('sk_test_x'), webhookSecret: encryptSecret(WHSEC) }, config: {} },
    }),
    prisma.integrationConnection.create({
      data: {
        accountId: ACC,
        provider: 'xero',
        status: 'connected',
        externalOrgId: xero.tenantId,
        expiresAt: new Date(Date.now() + 25 * 60_000),
        secretsEnc: { accessToken: encryptSecret(xero.accessToken), refreshToken: encryptSecret(xero.refreshToken), clientSecret: encryptSecret('xs') },
        config: { tenantId: xero.tenantId, clientId: 'xc', defaultRevenueAccountCode: '400', paymentAccountCode: '090', syncFromDate: '2020-01-01' },
      },
    }),
  ])
  ids.conns = conns.map((c) => c.id)
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})

afterAll(async () => {
  vi.unstubAllGlobals()
  const invs = [ids.invoice, ids.invoice2]
  if (!process.env.KEEP_CHAIN_ROWS) await prisma.invoiceEvent.deleteMany({ where: { accountId: ACC, invoiceId: { in: invs } } })
  await prisma.auditLog.deleteMany({ where: { accountId: ACC, entityId: { in: invs } } })
  await prisma.integrationSyncLog.deleteMany({ where: { accountId: ACC, createdAt: { gte: new Date(Date.now() - 3600_000) } } }).catch(() => {})
  await prisma.payment.deleteMany({ where: { invoiceId: { in: invs } } })
  await prisma.invoice.deleteMany({ where: { id: { in: invs } } })
  await prisma.client.deleteMany({ where: { id: ids.client } })
  await prisma.integrationConnection.deleteMany({ where: { id: { in: ids.conns } } })
  await prisma.$disconnect()
})

describe('billing chain: send → deliver → open → pay → Xero (live DB, faked providers)', () => {
  it('1. send: email accepted by SendGrid and the invoice copied to Xero', async () => {
    const r = await emailInvoiceToClient({ accountId: ACC, invoiceId: ids.invoice, actorUserId: null, kind: 'invoice', baseUrl: BASE })
    expect(r).toMatchObject({ ok: true, problem: null })
    expect(sendgrid[0]).toMatchObject({ to: [`ap-${tag}@example.com`], customArgs: { invoiceId: ids.invoice, accountId: ACC, traceKind: 'invoice' } })

    const x = await syncInvoiceToXero(ACC, ids.invoice, { budgetMs: 20_000 })
    expect(x.result).toBe('synced')
    expect(xero.invoices).toHaveLength(1)
    expect(xero.invoices[0]).toMatchObject({ InvoiceNumber: `C-${tag}`, Total: 1500 })
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: ids.invoice } })).xeroInvoiceId).toBe(xero.invoices[0].InvoiceID)

    const s = await stages(ids.invoice)
    expect(s).toEqual(expect.arrayContaining(['email.send_requested', 'email.accepted', 'xero.invoice_synced']))
  })

  it('2. SendGrid delivered + open events arrive signed; a replayed batch adds nothing', async () => {
    const now = Math.floor(Date.now() / 1000)
    const common = { email: `ap-${tag}@example.com`, sg_message_id: `SG${tag}-1.filter0`, invoiceId: ids.invoice, accountId: ACC, traceKind: 'invoice' }
    const batch = [
      { ...common, event: 'processed', timestamp: now, sg_event_id: `P-${tag}` },
      { ...common, event: 'delivered', timestamp: now, sg_event_id: `D-${tag}` },
      { ...common, event: 'open', timestamp: now + 1, sg_event_id: `O-${tag}`, useragent: 'Mozilla/5.0 (Macintosh)' },
    ]
    const r1 = await sendgridPost(batch)
    expect(r1.status).toBe(200)
    const b1 = await r1.json()
    expect(b1.failed).toBe(0)
    const before = (await trail(ids.invoice)).length
    const r2 = await sendgridPost(batch)
    expect(await r2.json()).toMatchObject({ recorded: 0, failed: 0 })
    expect((await trail(ids.invoice)).length).toBe(before)

    const s = await stages(ids.invoice)
    expect(count(s, 'email.delivered')).toBe(1)
    expect(count(s, 'email.opened')).toBe(1)
  })

  it('3. a forged SendGrid post is refused and writes nothing', async () => {
    const before = (await trail(ids.invoice)).length
    const body = JSON.stringify([{ event: 'spamreport', sg_event_id: `X-${tag}`, invoiceId: ids.invoice, accountId: ACC }])
    const res = await sendgridEvents(new Request(`${BASE}/api/email/events`, { method: 'POST', body, headers: { 'x-twilio-email-event-webhook-signature': 'MEUCIQ==', 'x-twilio-email-event-webhook-timestamp': String(Math.floor(Date.now() / 1000)) } }))
    expect(res.status).toBe(401)
    expect((await trail(ids.invoice)).length).toBe(before)
  })

  it('4. the client opening the link is traced once; a staff preview or prefetch is not', async () => {
    reqHeaders.clear()
    reqHeaders.set('x-request-method', 'GET')
    reqHeaders.set('user-agent', 'Mozilla/5.0 (Windows NT 10.0) Chrome/130')
    await recordInvoiceView({ id: ids.invoice, accountId: ACC })
    await recordInvoiceView({ id: ids.invoice, accountId: ACC }) // refresh a second later → not a new row
    reqHeaders.set('next-router-prefetch', '1')
    await recordInvoiceView({ id: ids.invoice, accountId: ACC })
    reqHeaders.clear()
    expect(count(await stages(ids.invoice), 'invoice.viewed')).toBe(1)
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: ids.invoice } })).lastViewedAt).not.toBeNull()
  })

  it('5. Stripe checkout completes: one payment, invoice paid, receipt emailed, payment in Xero', async () => {
    const res = await stripePost(checkoutCompleted(ids.invoice, `pi_${tag}`, 150000))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true, recorded: true })

    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: ids.invoice }, include: { payments: true } })
    expect(inv.status).toBe('paid')
    expect(inv.paidCents).toBe(150000)
    expect(inv.payments).toHaveLength(1)
    expect(inv.payments[0]).toMatchObject({ amountCents: 150000, method: 'card', stripeChargeId: `pi_${tag}` })
    expect(inv.payments[0].xeroPaymentId).toBeTruthy()

    expect(xero.invoices[0].Payments).toHaveLength(1)
    expect(xero.invoices[0].Payments[0]).toMatchObject({ Amount: 1500, Reference: expect.stringContaining(`T2:${inv.payments[0].id}`) })
    expect(xero.invoices[0].AmountDue).toBe(0)

    expect(sendgrid.filter((m) => m.customArgs.traceKind === 'receipt' || /receipt|payment/i.test(m.subject))).toHaveLength(1)
    const s = await stages(ids.invoice)
    expect(s).toEqual(expect.arrayContaining(['payment.webhook_received', 'payment.recorded', 'xero.payment_synced']))
  })

  it('6. Stripe redelivers the event (and sends the sibling events): nothing doubles anywhere', async () => {
    const before = { trail: (await trail(ids.invoice)).length, mails: sendgrid.length, xeroCalls: xero.calls.length }
    const replay = await stripePost(checkoutCompleted(ids.invoice, `pi_${tag}`, 150000))
    expect(replay.status).toBe(200)
    // payment_intent.succeeded for the same PaymentIntent, a different event id
    const sibling = { ...checkoutCompleted(ids.invoice, `pi_${tag}`, 150000), id: `evt_pis_${tag}`, type: 'payment_intent.succeeded' }
    sibling.data = { object: { id: `pi_${tag}`, object: 'payment_intent', amount_received: 150000, currency: 'usd', status: 'succeeded', metadata: { invoiceId: ids.invoice, accountId: ACC } } } as never
    expect((await stripePost(sibling)).status).toBe(200)

    expect(await prisma.payment.count({ where: { invoiceId: ids.invoice } })).toBe(1)
    expect(sendgrid.length).toBe(before.mails) // no second receipt
    expect(xero.invoices[0].Payments).toHaveLength(1)
    expect(xero.callsTo('PUT', '/Payments')).toHaveLength(1)
    const s = await stages(ids.invoice)
    expect(count(s, 'payment.recorded')).toBe(1)
    expect(count(s, 'payment.duplicate_ignored')).toBeGreaterThanOrEqual(1)
    // the replay of the exact same event id adds no webhook_received row; the sibling event adds one
    expect(count(s, 'payment.webhook_received')).toBe(2)
  })

  it('7. a webhook signed with the wrong secret is refused (400), traced as rejected, records nothing', async () => {
    const res = await stripePost(checkoutCompleted(ids.invoice2, `pi_forged_${tag}`, 42000), 'whsec_wrong')
    expect(res.status).toBe(400)
    expect(await prisma.payment.count({ where: { invoiceId: ids.invoice2 } })).toBe(0)
    const rejected = await prisma.invoiceEvent.findFirst({ where: { accountId: ACC, stage: 'payment.webhook_rejected' }, orderBy: { createdAt: 'desc' } })
    expect(rejected).toMatchObject({ level: 'warn', httpStatus: 400 })
    expect(JSON.stringify(rejected!.detail)).not.toContain('pi_forged')
  })

  it('8. Xero down when the payment arrives: payment still recorded, trail shows the error, retry completes it once', async () => {
    await emailInvoiceToClient({ accountId: ACC, invoiceId: ids.invoice2, actorUserId: null, kind: 'invoice', baseUrl: BASE })
    // Every Xero call fails with 503 (more than the client's retries).
    for (let i = 0; i < 12; i++) xero.failNext('GET', '/', { kind: '503' }), xero.failNext('PUT', '/', { kind: '503' }), xero.failNext('POST', '/', { kind: '503' })
    const res = await stripePost(checkoutCompleted(ids.invoice2, `pi2_${tag}`, 42000))
    expect(res.status).toBe(200) // the client is never shown an error for our Xero problem
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: ids.invoice2 }, include: { payments: true } })
    expect(inv.status).toBe('paid')
    expect(inv.payments[0].xeroPaymentId).toBeNull()
    const chipsDown = summarizeInvoiceTrace(await trail(ids.invoice2))
    expect(chipsDown.find((c) => c.key === 'stripe')).toMatchObject({ value: 'Paid', tone: 'ok' })
    expect(chipsDown.find((c) => c.key === 'xero')).toMatchObject({ tone: 'error' })

    // Xero recovers; the retry path (cron / "Copy to Xero") picks it up.
    xero.clearFaults()
    const run = await syncPendingXero(ACC, { budgetMs: 20_000 })
    expect(run.stoppedEarly).toBeNull()
    const after = await prisma.payment.findFirstOrThrow({ where: { invoiceId: ids.invoice2 } })
    expect(after.xeroPaymentId).toBeTruthy()
    const xi = xero.invoices.filter((i) => i.InvoiceNumber === `C2-${tag}`)
    expect(xi).toHaveLength(1)
    expect(xi[0].Payments).toHaveLength(1)

    // Running it again is a no-op.
    const putsBefore = xero.callsTo('PUT', '/Payments').length
    await syncPendingXero(ACC, { budgetMs: 20_000 })
    expect(xero.callsTo('PUT', '/Payments').length).toBe(putsBefore)
    expect(summarizeInvoiceTrace(await trail(ids.invoice2)).find((c) => c.key === 'xero')).toMatchObject({ tone: 'ok' })
  })

  it('9. the trail of the happy-path invoice reads end to end and stores no secrets', async () => {
    const rows = await trail(ids.invoice)
    const chips = Object.fromEntries(summarizeInvoiceTrace(rows).map((c) => [c.key, c.value]))
    expect(chips).toEqual({ email: 'Delivered', opened: 'Yes', stripe: 'Paid', xero: 'Synced (payment)' })
    expect(rows.filter((r) => r.level === 'error')).toEqual([])
    const blob = JSON.stringify(rows)
    for (const secret of [WHSEC, 'SG.test', 'sk_test_x', xero.accessToken, xero.refreshToken]) expect(blob).not.toContain(secret)
  })
})
