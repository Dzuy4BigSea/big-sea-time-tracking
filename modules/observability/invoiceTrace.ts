/**
 * Invoice trace: one row per step of an invoice's life (OPS.md "Invoice trace").
 *
 *   invoice.sent → email.accepted → email.delivered | email.bounced | email.spam_report | email.dropped
 *   → email.opened / invoice.viewed → payment.checkout_started → payment.webhook_received
 *   → payment.recorded | payment.failed → xero.invoice_synced / xero.payment_synced | xero.error
 *
 * Rules:
 * - Never throws and never blocks the business action: a failed trace write is logged to the
 *   console and swallowed.
 * - `detail` is redacted (secrets, tokens, auth headers, card data) and size-capped.
 * - Provider webhook retries are de-duplicated on (source, externalEventId).
 */
export type TraceSource = 'app' | 'email' | 'client' | 'stripe' | 'xero' | 'cron'
export type TraceLevel = 'info' | 'warn' | 'error'

export interface InvoiceTraceEvent {
  accountId: string
  invoiceId?: string | null
  paymentId?: string | null
  stage: string
  source: TraceSource
  level?: TraceLevel
  message: string
  externalId?: string | null
  externalEventId?: string | null
  httpStatus?: number | null
  durationMs?: number | null
  detail?: unknown
  occurredAt?: Date
}

const SECRET_KEY = /(secret|token|password|authorization|api[_-]?key|cookie|signature|card|cvc|iban|account_number|routing)/i
const MAX_STRING = 2000
const MAX_DEPTH = 6
const MAX_KEYS = 60

/** Deep-copy `value` with secret-looking keys masked and long strings / big objects trimmed. */
export function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (typeof value === 'string') return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '…[truncated]' : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (depth >= MAX_DEPTH) return '[depth limit]'
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS)) {
      out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1)
    }
    return out
  }
  return String(value)
}

/** Minimal persistence port so the helper is unit-testable without a database. */
export interface TraceStore {
  create(data: Required<Pick<InvoiceTraceEvent, 'accountId' | 'stage' | 'source' | 'message'>> & Record<string, unknown>): Promise<unknown>
}

export function toRow(e: InvoiceTraceEvent) {
  return {
    accountId: e.accountId,
    invoiceId: e.invoiceId ?? null,
    paymentId: e.paymentId ?? null,
    stage: e.stage,
    source: e.source,
    level: e.level ?? 'info',
    message: e.message.slice(0, 1000),
    externalId: e.externalId ?? null,
    externalEventId: e.externalEventId ?? null,
    httpStatus: e.httpStatus ?? null,
    durationMs: e.durationMs ?? null,
    detail: e.detail === undefined ? undefined : (redact(e.detail) as object),
    ...(e.occurredAt ? { occurredAt: e.occurredAt } : {}),
  }
}

/** True when the store rejected a duplicate (source, externalEventId), i.e. a provider retry. */
function isDuplicate(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002'
}

/**
 * Record one trace event. Returns 'recorded' | 'duplicate' | 'failed'; never throws.
 * Pass `store` in tests; production uses Prisma.
 */
export async function recordInvoiceEvent(e: InvoiceTraceEvent, store?: TraceStore): Promise<'recorded' | 'duplicate' | 'failed'> {
  try {
    const s = store ?? (await defaultStore())
    await s.create(toRow(e))
    return 'recorded'
  } catch (err) {
    if (isDuplicate(err)) return 'duplicate'
    console.error('[invoice-trace] failed to record', e.stage, (err as Error)?.message)
    return 'failed'
  }
}

/** Time an async step and record it (ok → info, throw → error, rethrown). */
export async function traced<T>(
  base: Omit<InvoiceTraceEvent, 'durationMs' | 'level' | 'message'> & { message?: string },
  fn: () => Promise<T>,
  store?: TraceStore,
): Promise<T> {
  const t0 = Date.now()
  try {
    const out = await fn()
    await recordInvoiceEvent({ ...base, message: base.message ?? `${base.stage} ok`, level: 'info', durationMs: Date.now() - t0 }, store)
    return out
  } catch (err) {
    await recordInvoiceEvent(
      { ...base, level: 'error', message: `${base.stage} failed: ${(err as Error)?.message ?? String(err)}`, durationMs: Date.now() - t0 },
      store,
    )
    throw err
  }
}

async function defaultStore(): Promise<TraceStore> {
  const { prisma } = await import('@/lib/prisma')
  return {
    create: async (data) => {
      if (!data.externalEventId) return prisma.invoiceEvent.create({ data: data as never })
      // Provider retries are expected: ON CONFLICT DO NOTHING keeps them out of the error log
      // (a caught P2002 is still printed as prisma:error), then report them as duplicates.
      const { count } = await prisma.invoiceEvent.createMany({ data: [data as never], skipDuplicates: true })
      if (count === 0) throw Object.assign(new Error('duplicate provider event'), { code: 'P2002' })
    },
  }
}
