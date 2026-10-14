/**
 * Xero HTTP layer (specs/14 §Xero, OPS.md "Xero sync"). DB-free and dependency-injected so it is
 * unit-tested with a mocked `fetch`.
 *
 * - Every call has a timeout (AbortController, 15s default, shortened by an optional deadline).
 * - 429: honours Retry-After (capped), at most `maxRetries` (3) retries; reported through `onEvent`.
 * - 5xx / timeout / network: retried with exponential backoff only when the caller says the request
 *   is safe to repeat (`retryTransient`); creates pass an Idempotency-Key and their own look-up.
 * - 4xx: never retried. 400 → `validation` with Xero's ValidationErrors messages; 401/403 → `auth`;
 *   404 → `not_found`.
 * Tokens never leave this module in an error or event: only status, Xero's response body and headers
 * that matter (Retry-After, rate-limit problem) are kept.
 */

export const XERO_API = 'https://api.xero.com/api.xro/2.0'
export const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections'
export const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'

export const DEFAULT_TIMEOUT_MS = 15_000
export const DEFAULT_MAX_RETRIES = 3
/** Longest Retry-After we will sleep through in-request; longer (daily limit) → give up, retry later. */
export const MAX_RETRY_AFTER_MS = 60_000

export type XeroErrorKind = 'auth' | 'rate_limited' | 'validation' | 'not_found' | 'http' | 'timeout' | 'network'

export class XeroError extends Error {
  readonly kind: XeroErrorKind
  readonly status: number | null
  readonly validationMessages: string[]
  readonly retryAfterSec: number | null
  /** Xero's response body (parsed JSON or a text snippet). Never contains our tokens. */
  readonly body: unknown
  constructor(kind: XeroErrorKind, message: string, opts: { status?: number | null; validationMessages?: string[]; retryAfterSec?: number | null; body?: unknown } = {}) {
    super(message)
    this.name = 'XeroError'
    this.kind = kind
    this.status = opts.status ?? null
    this.validationMessages = opts.validationMessages ?? []
    this.retryAfterSec = opts.retryAfterSec ?? null
    this.body = opts.body
  }
  /** The request may or may not have been applied by Xero (look up before re-creating). */
  get uncertain(): boolean {
    return this.kind === 'timeout' || this.kind === 'network' || (this.kind === 'http' && (this.status ?? 0) >= 500)
  }
}

export interface XeroHttpEvent {
  type: 'rate_limited'
  method: string
  url: string
  retryAfterSec: number
  attempt: number
  willRetry: boolean
  problem: string | null
}

export interface XeroHttpDeps {
  fetch: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  timeoutMs?: number
  maxRetries?: number
  /** Epoch ms after which no new attempt / wait starts (keeps webhooks and actions bounded). */
  deadline?: number | null
  onEvent?: (e: XeroHttpEvent) => void | Promise<void>
}

export interface XeroHttpRequest {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string
  /** Repeat on 5xx / timeout / network. Safe for GETs and for writes carrying an Idempotency-Key. */
  retryTransient?: boolean
}

export interface XeroHttpResponse {
  status: number
  json: any
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Pull human-readable messages out of Xero's error shapes. */
export function xeroValidationMessages(body: any): string[] {
  const out: string[] = []
  const push = (m: unknown) => {
    if (typeof m === 'string' && m && !out.includes(m)) out.push(m)
  }
  if (!body || typeof body !== 'object') return out
  for (const el of Array.isArray(body.Elements) ? body.Elements : []) {
    for (const v of Array.isArray(el?.ValidationErrors) ? el.ValidationErrors : []) push(v?.Message)
  }
  // summarizeErrors=false shape: Invoices[i].ValidationErrors / Payments[i].ValidationErrors
  for (const key of ['Invoices', 'Payments', 'Contacts']) {
    for (const el of Array.isArray(body[key]) ? body[key] : []) {
      for (const v of Array.isArray(el?.ValidationErrors) ? el.ValidationErrors : []) push(v?.Message)
    }
  }
  return out
}

function errorSummary(body: any, fallback: string): string {
  if (body && typeof body === 'object') {
    return String(body.Detail ?? body.Message ?? body.Title ?? body.error_description ?? body.error ?? fallback)
  }
  return typeof body === 'string' && body ? body.slice(0, 200) : fallback
}

async function readBody(res: Response): Promise<any> {
  const text = await res.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text.slice(0, 1000)
  }
}

/** One Xero HTTP request with timeout, rate-limit and transient-error handling. */
export async function xeroHttp(deps: XeroHttpDeps, req: XeroHttpRequest): Promise<XeroHttpResponse> {
  const sleep = deps.sleep ?? defaultSleep
  const now = deps.now ?? Date.now
  const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const deadline = deps.deadline ?? null
  const canWait = (ms: number) => deadline == null || now() + ms < deadline

  for (let attempt = 0; ; attempt++) {
    const remaining = deadline == null ? timeoutMs : Math.max(1_000, Math.min(timeoutMs, deadline - now()))
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), remaining)
    let res: Response
    try {
      res = await deps.fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: ctrl.signal })
    } catch (e) {
      clearTimeout(timer)
      const aborted = ctrl.signal.aborted || (e as Error)?.name === 'AbortError'
      const err = aborted
        ? new XeroError('timeout', `Xero ${req.method} timed out after ${remaining}ms`)
        : new XeroError('network', `Xero ${req.method} network error: ${(e as Error)?.message ?? String(e)}`)
      const backoff = 500 * 2 ** attempt
      if (req.retryTransient && attempt < maxRetries && canWait(backoff)) {
        await sleep(backoff)
        continue
      }
      throw err
    }
    clearTimeout(timer)

    if (res.ok) return { status: res.status, json: await readBody(res) }

    const body = await readBody(res)
    const status = res.status
    if (status === 429) {
      const ra = Number(res.headers.get('retry-after'))
      const retryAfterSec = Number.isFinite(ra) && ra >= 0 ? ra : 2 ** attempt
      const waitMs = retryAfterSec * 1000
      const willRetry = attempt < maxRetries && waitMs <= MAX_RETRY_AFTER_MS && canWait(waitMs)
      await deps.onEvent?.({
        type: 'rate_limited',
        method: req.method,
        url: req.url,
        retryAfterSec,
        attempt,
        willRetry,
        problem: res.headers.get('x-rate-limit-problem'),
      })
      if (willRetry) {
        await sleep(waitMs)
        continue
      }
      throw new XeroError('rate_limited', `Xero rate limit (${res.headers.get('x-rate-limit-problem') ?? 'unknown'}); retry after ${retryAfterSec}s`, { status, retryAfterSec, body })
    }
    if (status >= 500) {
      const backoff = 500 * 2 ** attempt
      if (req.retryTransient && attempt < maxRetries && canWait(backoff)) {
        await sleep(backoff)
        continue
      }
      throw new XeroError('http', `Xero ${req.method} → ${status}: ${errorSummary(body, 'server error')}`, { status, body })
    }
    if (status === 401 || status === 403) {
      throw new XeroError('auth', `Xero ${req.method} → ${status}: ${errorSummary(body, 'unauthorized')}`, { status, body })
    }
    if (status === 404) throw new XeroError('not_found', `Xero ${req.method} → 404 not found`, { status, body })
    const messages = xeroValidationMessages(body)
    if (status === 400 && messages.length) {
      throw new XeroError('validation', `Xero rejected the request: ${messages.join('; ')}`, { status, validationMessages: messages, body })
    }
    throw new XeroError('http', `Xero ${req.method} → ${status}: ${errorSummary(body, 'client error')}`, { status, body, validationMessages: messages })
  }
}

/** Supplies a bearer token; `force` asks for a refreshed one after a 401. */
export interface XeroTokenSource {
  get(force?: boolean): Promise<string>
  /** Xero refused a fresh token (401 after refresh, or 403): the connection needs a reconnect. */
  rejected?(reason: string): Promise<void>
}

export interface XeroCallOptions {
  body?: unknown
  idempotencyKey?: string
  retryTransient?: boolean
}

/** Tenant-scoped Xero Accounting API client. Refreshes once on 401, then gives up (no loops). */
export class XeroApi {
  constructor(
    readonly http: XeroHttpDeps,
    readonly tenantId: string,
    private readonly tokens: XeroTokenSource,
  ) {}

  async call(method: string, path: string, opts: XeroCallOptions = {}): Promise<any> {
    const send = async (token: string) =>
      xeroHttp(this.http, {
        method,
        url: `${XERO_API}${path}`,
        headers: {
          Authorization: `Bearer ${token}`,
          'xero-tenant-id': this.tenantId,
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        retryTransient: opts.retryTransient ?? method === 'GET',
      })
    const refused = async (e: unknown) => {
      if (e instanceof XeroError && e.kind === 'auth') await this.tokens.rejected?.(e.message)
      return e
    }
    try {
      return (await send(await this.tokens.get(false))).json
    } catch (e) {
      if (!(e instanceof XeroError) || e.kind !== 'auth') throw e
      // 403 = tenant disconnected / scope missing: refreshing will not help.
      if (e.status !== 401) throw await refused(e)
    }
    // 401 = token expired or revoked: refresh once and retry once. A second 401 needs a reconnect.
    try {
      return (await send(await this.tokens.get(true))).json
    } catch (e) {
      throw await refused(e)
    }
  }
}
