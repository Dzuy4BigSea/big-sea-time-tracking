import { describe, it, expect, vi } from 'vitest'
import { xeroHttp, xeroValidationMessages, XeroError, XERO_API, type XeroHttpDeps } from './xeroClient'

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })

function deps(responses: Array<Response | 'hang'>, over: Partial<XeroHttpDeps> = {}) {
  const sleeps: number[] = []
  const events: unknown[] = []
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const next = responses.shift()
    if (!next) throw new Error('no more responses')
    if (next === 'hang') {
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    }
    return next
  })
  const d: XeroHttpDeps = { fetch: fetchMock as unknown as typeof fetch, sleep: async (ms) => void sleeps.push(ms), onEvent: (e) => void events.push(e), timeoutMs: 20, ...over }
  return { d, fetchMock, sleeps, events }
}

const GET = { method: 'GET', url: `${XERO_API}/Invoices/x`, retryTransient: true }
const PUT = { method: 'PUT', url: `${XERO_API}/Invoices`, body: '{}', retryTransient: false }

describe('xeroHttp', () => {
  it('429: respects Retry-After and gives up after 3 retries (rate_limited, retryable later)', async () => {
    const r429 = () => res(429, { Title: 'Too Many Requests' }, { 'retry-after': '2', 'x-rate-limit-problem': 'minute' })
    const { d, fetchMock, sleeps, events } = deps([r429(), r429(), r429(), r429()])
    const err = await xeroHttp(d, PUT).catch((e) => e)
    expect(err).toBeInstanceOf(XeroError)
    expect(err.kind).toBe('rate_limited')
    expect(err.retryAfterSec).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(sleeps).toEqual([2000, 2000, 2000])
    expect(events).toHaveLength(4)
  })

  it('429 with a daily-limit Retry-After is not slept through', async () => {
    const { d, fetchMock, sleeps } = deps([res(429, {}, { 'retry-after': '3600', 'x-rate-limit-problem': 'day' })])
    const err = await xeroHttp(d, GET).catch((e) => e)
    expect(err.kind).toBe('rate_limited')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sleeps).toEqual([])
  })

  it('5xx: retried with backoff when safe, not retried for an uncertain create', async () => {
    const a = deps([res(503, 'Service Unavailable'), res(500, { Detail: 'boom' }), res(200, { Invoices: [] })])
    await expect(xeroHttp(a.d, GET)).resolves.toMatchObject({ status: 200 })
    expect(a.sleeps).toEqual([500, 1000])

    const b = deps([res(500, { Detail: 'boom' })])
    const err = await xeroHttp(b.d, PUT).catch((e) => e)
    expect(err.kind).toBe('http')
    expect(err.uncertain).toBe(true)
    expect(b.fetchMock).toHaveBeenCalledTimes(1)
  })

  it('4xx is never retried; 400 carries Xero’s ValidationErrors', async () => {
    const body = { ErrorNumber: 10, Type: 'ValidationException', Message: 'A validation exception occurred', Elements: [{ ValidationErrors: [{ Message: 'Invoice # must be unique.' }, { Message: 'Due Date is mandatory for approved documents.' }] }] }
    const { d, fetchMock } = deps([res(400, body)])
    const err = await xeroHttp(d, GET).catch((e) => e)
    expect(err.kind).toBe('validation')
    expect(err.validationMessages).toEqual(['Invoice # must be unique.', 'Due Date is mandatory for approved documents.'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('401 / 403 → auth; 404 → not_found', async () => {
    expect((await xeroHttp(deps([res(401, { Title: 'Unauthorized', Status: 401, Detail: 'TokenExpired: token expired at …' })]).d, GET).catch((e) => e)).kind).toBe('auth')
    expect((await xeroHttp(deps([res(403, { Title: 'Forbidden', Detail: 'AuthenticationUnsuccessful' })]).d, GET).catch((e) => e)).kind).toBe('auth')
    expect((await xeroHttp(deps([res(404, '')]).d, GET).catch((e) => e)).kind).toBe('not_found')
  })

  it('times out with AbortController and reports an uncertain timeout', async () => {
    const { d, fetchMock } = deps(['hang'])
    const err = await xeroHttp(d, PUT).catch((e) => e)
    expect(err.kind).toBe('timeout')
    expect(err.uncertain).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a deadline stops further retries', async () => {
    let t = 0
    const { d, fetchMock } = deps([res(503, ''), res(200, {})], { now: () => t, deadline: 100, sleep: async (ms) => void (t += ms) })
    const err = await xeroHttp(d, GET).catch((e) => e)
    expect(err.kind).toBe('http')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('xeroValidationMessages', () => {
  it('reads the summarizeErrors=false shape too', () => {
    expect(xeroValidationMessages({ Invoices: [{ HasErrors: true, ValidationErrors: [{ Message: 'Account code is not valid' }] }] })).toEqual(['Account code is not valid'])
  })
})
