import { describe, expect, it, vi } from 'vitest'
import { recordInvoiceEvent, redact, traced, toRow, type TraceStore } from './invoiceTrace'

const memStore = () => {
  const rows: Record<string, unknown>[] = []
  const store: TraceStore = { create: async (d) => { rows.push(d) } }
  return { rows, store }
}

describe('redact', () => {
  it('masks secret-looking keys at any depth and keeps the rest', () => {
    const out = redact({ id: 'pi_1', headers: { Authorization: 'Bearer x', 'x-ok': 1 }, client_secret: 's', nested: { api_key: 'k', amount: 500 } }) as Record<string, any>
    expect(out.id).toBe('pi_1')
    expect(out.headers.Authorization).toBe('[redacted]')
    expect(out.headers['x-ok']).toBe(1)
    expect(out.client_secret).toBe('[redacted]')
    expect(out.nested.api_key).toBe('[redacted]')
    expect(out.nested.amount).toBe(500)
  })
  it('truncates long strings and limits depth', () => {
    expect((redact('x'.repeat(3000)) as string).endsWith('…[truncated]')).toBe(true)
    let deep: any = { v: 1 }
    for (let i = 0; i < 10; i++) deep = { d: deep }
    expect(JSON.stringify(redact(deep))).toContain('[depth limit]')
  })
})

describe('recordInvoiceEvent', () => {
  it('records a redacted row with defaults', async () => {
    const { rows, store } = memStore()
    const r = await recordInvoiceEvent({ accountId: 'a', invoiceId: 'i', stage: 'email.accepted', source: 'email', message: 'ok', detail: { token: 't' } }, store)
    expect(r).toBe('recorded')
    expect(rows[0]).toMatchObject({ accountId: 'a', invoiceId: 'i', level: 'info', detail: { token: '[redacted]' } })
  })
  it('reports webhook retries as duplicates', async () => {
    const store: TraceStore = { create: async () => { throw Object.assign(new Error('dup'), { code: 'P2002' }) } }
    expect(await recordInvoiceEvent({ accountId: 'a', stage: 's', source: 'stripe', message: 'm', externalEventId: 'evt_1' }, store)).toBe('duplicate')
  })
  it('never throws when the store fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store: TraceStore = { create: async () => { throw new Error('db down') } }
    expect(await recordInvoiceEvent({ accountId: 'a', stage: 's', source: 'app', message: 'm' }, store)).toBe('failed')
    spy.mockRestore()
  })
  it('caps message length', () => {
    expect(toRow({ accountId: 'a', stage: 's', source: 'app', message: 'm'.repeat(5000) }).message.length).toBe(1000)
  })
})

describe('traced', () => {
  it('records duration on success and error on failure (rethrowing)', async () => {
    const { rows, store } = memStore()
    await expect(traced({ accountId: 'a', stage: 'xero.invoice_synced', source: 'xero' }, async () => 42, store)).resolves.toBe(42)
    await expect(traced({ accountId: 'a', stage: 'xero.invoice_synced', source: 'xero' }, async () => { throw new Error('boom') }, store)).rejects.toThrow('boom')
    expect(rows[0]).toMatchObject({ level: 'info' })
    expect(rows[1]).toMatchObject({ level: 'error', message: 'xero.invoice_synced failed: boom' })
    expect(typeof rows[1].durationMs).toBe('number')
  })
})
