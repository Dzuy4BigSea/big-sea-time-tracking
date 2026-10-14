import { describe, it, expect } from 'vitest'
import { blockingSend, claimInvoiceEmail, sendGroup, type TraceRowLite } from './sendGuard'

const now = new Date('2026-10-14T12:00:00Z')
const ago = (s: number) => new Date(now.getTime() - s * 1000)
const req = (s: number, sendId: string, traceKind = 'invoice'): TraceRowLite => ({ stage: 'email.send_requested', occurredAt: ago(s), detail: { sendId, traceKind } })
const rej = (s: number, sendId: string): TraceRowLite => ({ stage: 'email.rejected', occurredAt: ago(s), detail: { sendId } })

describe('blockingSend', () => {
  it('nothing recent → send', () => {
    expect(blockingSend([], 'resend', now)).toBeNull()
  })
  it('a claim 5s ago (in flight or accepted) blocks a second resend', () => {
    expect(blockingSend([req(5, 'a')], 'resend', now)).not.toBeNull()
  })
  it('a first send blocks an immediate "Resend invoice" (same message)', () => {
    expect(sendGroup('resend')).toBe('invoice')
    expect(blockingSend([req(5, 'a', 'invoice')], 'resend', now)).not.toBeNull()
  })
  it('a rejected send does not block the retry', () => {
    expect(blockingSend([req(5, 'a'), rej(4, 'a')], 'resend', now)).toBeNull()
  })
  it('older than the window → send', () => {
    expect(blockingSend([req(61, 'a')], 'resend', now)).toBeNull()
  })
  it('reminders and invoice mail are separate groups', () => {
    expect(blockingSend([req(5, 'a', 'invoice')], 'reminder', now)).toBeNull()
    expect(blockingSend([req(5, 'a', 'reminder')], 'reminder', now)).not.toBeNull()
  })
})

describe('claimInvoiceEmail', () => {
  function fakeDb() {
    const rows: (TraceRowLite & Record<string, unknown>)[] = []
    const locks: string[] = []
    const tx = {
      $queryRaw: async (_q: TemplateStringsArray, ...v: unknown[]) => {
        locks.push(String(v[0]))
        return []
      },
      invoiceEvent: {
        findMany: async () => rows.map((r) => ({ stage: r.stage, occurredAt: r.occurredAt, detail: r.detail })),
        create: async ({ data }: { data: Record<string, unknown> }) => {
          rows.push({ ...(data as object), occurredAt: (data.occurredAt as Date) ?? now } as TraceRowLite & Record<string, unknown>)
        },
      },
    }
    return { db: { $transaction: <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx) }, rows, locks }
  }

  it('grants the first claim, records email.send_requested, refuses the double click', async () => {
    const { db, rows, locks } = fakeDb()
    const a = await claimInvoiceEmail(db as never, { accountId: 'acc', invoiceId: 'inv', kind: 'resend', recipients: ['a@x.com'], now })
    expect(a.ok).toBe(true)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ stage: 'email.send_requested', source: 'app', accountId: 'acc', invoiceId: 'inv' })
    expect((rows[0].detail as { traceKind: string }).traceKind).toBe('resend')
    const b = await claimInvoiceEmail(db as never, { accountId: 'acc', invoiceId: 'inv', kind: 'resend', recipients: ['a@x.com'], now: new Date(now.getTime() + 800) })
    expect(b).toEqual({ ok: false, secondsAgo: 1 })
    expect(rows).toHaveLength(1)
    expect(locks).toEqual(['invoice-email:inv', 'invoice-email:inv'])
  })
})
