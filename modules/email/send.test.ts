import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// DB-free: the connection, entity lookups and trace store are mocked; fetch is the SendGrid stub.
const traced: Record<string, unknown>[] = []
vi.mock('@/lib/prisma', () => ({
  prisma: {
    businessEntity: { findFirst: vi.fn(async () => ({ senderName: 'Cordelia Labs', senderEmail: 'billing@cordelialabs.com', replyToEmail: null })) },
    senderAddress: { findFirst: vi.fn(async () => ({ name: 'Big Sea Billing', email: 'ar@bigsea.co' })) },
    invoiceEvent: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => traced.push(data)) },
  },
}))
vi.mock('@/lib/integrations', () => ({
  getConnectionWithSecrets: vi.fn(async () => ({ status: 'connected', config: { fromEmail: 'billing@bigsea.co', fromName: 'Big Sea' }, secrets: { apiKey: 'SG.secret' } })),
}))

import { sendEmail } from './send'

const fetchMock = vi.fn()
beforeEach(() => {
  traced.length = 0
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const input = { to: ['ap@client.com'], subject: 'Invoice 1', html: '<p>x</p>', text: 'x', entityId: 'ent_cl', trace: { invoiceId: 'inv_1', kind: 'invoice' as const, sendId: 'S1' } }

describe('sendEmail (mocked SendGrid)', () => {
  it('202 → email.accepted with the X-Message-Id; payload carries custom_args, entity sender, account reply-to', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202, headers: { 'X-Message-Id': 'MSG-1' } }))
    const r = await sendEmail('acc_1', input)
    expect(r).toMatchObject({ ok: true, messageId: 'MSG-1', httpStatus: 202 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send')
    const body = JSON.parse(init.body)
    expect(body.from).toEqual({ email: 'billing@cordelialabs.com', name: 'Cordelia Labs' })
    expect(body.reply_to).toEqual({ email: 'ar@bigsea.co' }) // default Sender address fills the gap
    expect(body.personalizations[0].custom_args).toEqual({ invoiceId: 'inv_1', accountId: 'acc_1', traceKind: 'invoice' })
    expect(body.tracking_settings.click_tracking.enable).toBe(false)
    expect(traced).toHaveLength(1)
    expect(traced[0]).toMatchObject({ stage: 'email.accepted', source: 'app', level: 'info', externalId: 'MSG-1', httpStatus: 202, invoiceId: 'inv_1' })
    expect(traced[0].detail).toMatchObject({ sendId: 'S1', traceKind: 'invoice' })
  })

  it('4xx → email.rejected with status + provider error, never the API key', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ errors: [{ message: 'does not match a verified Sender Identity', field: 'from' }] }), { status: 403 }))
    const r = await sendEmail('acc_1', input)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('SendGrid 403')
    expect(traced[0]).toMatchObject({ stage: 'email.rejected', level: 'error', httpStatus: 403 })
    expect(JSON.stringify(traced)).not.toContain('SG.secret')
  })

  it('network failure → email.rejected, no throw', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    const r = await sendEmail('acc_1', input)
    expect(r).toMatchObject({ ok: false, message: 'ECONNRESET' })
    expect(traced[0]).toMatchObject({ stage: 'email.rejected', level: 'error' })
  })

  it('no valid recipient → skipped, traced as a warning, provider not called', async () => {
    const r = await sendEmail('acc_1', { ...input, to: ['not-an-email'] })
    expect(r).toMatchObject({ ok: false, skipped: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(traced[0]).toMatchObject({ stage: 'email.rejected', level: 'warn' })
  })
})
