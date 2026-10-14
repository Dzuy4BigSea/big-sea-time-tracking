/**
 * Invoice email trace end to end against a live (throwaway) DB with SendGrid mocked at fetch:
 * send → email.send_requested → email.accepted (X-Message-Id) → double-click refused →
 * signed webhook delivered/bounce → trace rows (de-duplicated on retry). Also a rejected send
 * followed by a successful retry.
 *
 * Creates its own client/contacts/invoice/SendGrid connection in acc_globex and removes them after.
 * Run with: npm run test:integration (needs DATABASE_URL to a disposable database).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto'

vi.mock('server-only', () => ({}))
process.env.INTEGRATION_ENC_KEY ??= 'integration-test-key-0123456789'

const { prisma } = await import('@/lib/prisma')
const { encryptSecret } = await import('@/lib/crypto')
const { emailInvoiceToClient, sendReminder } = await import('@/modules/email/invoiceEmails')
const { handleSendGridWebhook } = await import('@/modules/email/sendgridWebhook')
const { recordInvoiceEvent } = await import('@/modules/observability/invoiceTrace')

const ACC = 'acc_globex'
const tag = randomBytes(4).toString('hex')
let clientId = ''
let invoiceId = ''
let connId = ''

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const PUB = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
function signed(body: string) {
  const ts = String(Math.floor(Date.now() / 1000))
  return { rawBody: body, timestamp: ts, signature: sign('sha256', Buffer.from(ts + body), privateKey).toString('base64') }
}
const deps = {
  invoiceInAccount: async (i: string, a: string) => !!(await prisma.invoice.findFirst({ where: { id: i, accountId: a }, select: { id: true } })),
  record: (e: Parameters<typeof recordInvoiceEvent>[0]) => recordInvoiceEvent(e),
}

const fetchMock = vi.fn()
const events = () => prisma.invoiceEvent.findMany({ where: { accountId: ACC, invoiceId }, orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] })

beforeAll(async () => {
  const conflict = await prisma.integrationConnection.findFirst({ where: { accountId: ACC, provider: 'sendgrid' } })
  if (conflict) throw new Error('acc_globex already has a SendGrid connection; refusing to touch it')
  const client = await prisma.client.create({
    data: {
      accountId: ACC,
      name: `Trace Test ${tag}`,
      contacts: {
        create: [
          { accountId: ACC, firstName: 'Ann', lastName: 'Payable', email: `ap-${tag}@example.com`, isInvoiceRecipient: true },
          { accountId: ACC, firstName: 'Cee', lastName: 'Fo', email: `cfo-${tag}@example.com`, isInvoiceRecipient: true },
          { accountId: ACC, firstName: 'Pat', lastName: 'Manager', email: `pm-${tag}@example.com`, isInvoiceRecipient: false },
        ],
      },
    },
  })
  clientId = client.id
  const inv = await prisma.invoice.create({
    data: { accountId: ACC, clientId, status: 'open', number: `T-${tag}`, sentAt: new Date(), totalCents: 120000, publicToken: randomBytes(24).toString('hex'), dueDate: new Date('2026-01-01') },
  })
  invoiceId = inv.id
  const conn = await prisma.integrationConnection.create({
    data: { accountId: ACC, provider: 'sendgrid', status: 'connected', secretsEnc: { apiKey: encryptSecret('SG.test-key') }, config: { fromEmail: 'billing@bigsea.co', fromName: 'Big Sea' } },
  })
  connId = conn.id
  vi.stubGlobal('fetch', fetchMock)
})

beforeEach(() => fetchMock.mockReset())

afterAll(async () => {
  vi.unstubAllGlobals()
  await prisma.invoiceEvent.deleteMany({ where: { accountId: ACC, invoiceId } })
  await prisma.auditLog.deleteMany({ where: { accountId: ACC, entityId: invoiceId } })
  await prisma.invoice.deleteMany({ where: { id: invoiceId } })
  await prisma.client.deleteMany({ where: { id: clientId } })
  await prisma.integrationConnection.deleteMany({ where: { id: connId } })
  await prisma.$disconnect()
})

describe('invoice email trace (mocked SendGrid, live DB)', () => {
  it('a rejected send is traced with status + error, and a retry right after is allowed', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ message: 'Maximum credits exceeded' }] }), { status: 401 }))
    const r1 = await emailInvoiceToClient({ accountId: ACC, invoiceId, actorUserId: null, kind: 'invoice', baseUrl: 'https://track2.example.com' })
    expect(r1.ok).toBe(false)
    expect(r1.problem).toContain('SendGrid 401')
    const rows = await events()
    expect(rows.map((r) => r.stage)).toEqual(['email.send_requested', 'email.rejected'])
    expect(rows[1]).toMatchObject({ httpStatus: 401, level: 'error' })

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202, headers: { 'X-Message-Id': `MSG${tag}` } }))
    const r2 = await emailInvoiceToClient({ accountId: ACC, invoiceId, actorUserId: null, kind: 'resend', baseUrl: 'https://track2.example.com' })
    expect(r2).toMatchObject({ ok: true, problem: null })
    expect(r2.summary).toContain('and 1 other')
    const body = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(body.personalizations[0].to.map((t: { email: string }) => t.email)).toEqual([`ap-${tag}@example.com`, `cfo-${tag}@example.com`])
    expect(body.personalizations[0].custom_args).toEqual({ invoiceId, accountId: ACC, traceKind: 'resend' })
    expect(body.content[0].value).toContain(`https://track2.example.com/i/`)
    const accepted = (await events()).find((r) => r.stage === 'email.accepted')
    expect(accepted).toMatchObject({ externalId: `MSG${tag}`, httpStatus: 202, source: 'app' })
    expect(accepted!.durationMs).not.toBeNull()
  })

  it('a double-clicked resend sends nothing the second time (concurrent requests too)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202, headers: { 'X-Message-Id': 'never' } }))
    const [a, b] = await Promise.all([
      emailInvoiceToClient({ accountId: ACC, invoiceId, actorUserId: null, kind: 'resend', baseUrl: 'https://track2.example.com' }),
      emailInvoiceToClient({ accountId: ACC, invoiceId, actorUserId: null, kind: 'resend', baseUrl: 'https://track2.example.com' }),
    ])
    expect(a.duplicate && b.duplicate).toBe(true) // the accepted send from the previous test is < 60s old
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reminders are their own group; two concurrent clicks send exactly one', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202, headers: { 'X-Message-Id': `REM${tag}` } }))
    const rs = await Promise.all([1, 2, 3].map(() => sendReminder(ACC, invoiceId, 'https://track2.example.com')))
    expect(rs.filter((r) => r.ok)).toHaveLength(1)
    expect(rs.filter((r) => r.duplicate)).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const subject = JSON.parse(fetchMock.mock.calls[0][1].body).subject as string
    expect(subject).toMatch(/days past due/)
  })

  it('signed webhook events land on the trace, keyed to the message id, and retries de-dup', async () => {
    const payload = JSON.stringify([
      { event: 'delivered', email: `ap-${tag}@example.com`, timestamp: Math.floor(Date.now() / 1000), sg_event_id: `D-${tag}`, sg_message_id: `MSG${tag}.filter1`, invoiceId, accountId: ACC, traceKind: 'resend' },
      { event: 'bounce', email: `cfo-${tag}@example.com`, timestamp: Math.floor(Date.now() / 1000), sg_event_id: `B-${tag}`, sg_message_id: `MSG${tag}.filter2`, reason: '550 5.1.1 user unknown', invoiceId, accountId: ACC, traceKind: 'resend' },
      { event: 'delivered', sg_event_id: `F-${tag}`, invoiceId, accountId: 'acc_demo' }, // wrong account → ignored
    ])
    const r = await handleSendGridWebhook(signed(payload), PUB, deps)
    expect(r).toEqual({ status: 200, body: { recorded: 2, duplicate: 0, ignored: 1, failed: 0 } })
    const retry = await handleSendGridWebhook(signed(payload), PUB, deps)
    expect(retry.body).toMatchObject({ recorded: 0, duplicate: 2 })

    const rows = await events()
    const delivered = rows.find((x) => x.stage === 'email.delivered')!
    const bounced = rows.find((x) => x.stage === 'email.bounced')!
    expect(delivered).toMatchObject({ source: 'email', externalId: `MSG${tag}`, level: 'info' })
    expect(bounced).toMatchObject({ source: 'email', externalId: `MSG${tag}`, level: 'error' })
    expect(bounced.message).toContain('550 5.1.1')
    expect(rows.filter((x) => x.externalId === `MSG${tag}`).map((x) => x.stage).sort()).toEqual(['email.accepted', 'email.bounced', 'email.delivered'])
  })

  it('unsigned webhook posts are refused and write nothing', async () => {
    const before = (await events()).length
    const r = await handleSendGridWebhook({ rawBody: '[]', signature: null, timestamp: null }, PUB, deps)
    expect(r.status).toBe(401)
    expect((await events()).length).toBe(before)
  })
})
