/**
 * Track2 → Xero invoice + payment copy (specs/14 §Xero, specs/16 AC-ENT-007, OPS.md "Xero sync").
 * DB-free: persistence and tracing go through `XeroSyncRepo` so every path is unit-tested with a
 * mocked `fetch`. The server wiring (Prisma, encryption, entity routing) is in `xeroSync.ts`.
 *
 * Exactly-once rules:
 * - An invoice with a stored Xero id is fetched and compared, then left alone or updated — never
 *   created again. Without one, Xero is searched by InvoiceNumber first (catches a create whose
 *   response was lost, and Harvest's own copies), then created with PUT + Idempotency-Key. An
 *   uncertain failure (timeout / 5xx / network) is followed by another look-up before any retry.
 * - Invoices that came from Harvest, or were sent before the connection's cutoff, are only ever
 *   linked by number, never created (Harvest already put them in Xero).
 * - Each payment carries `T2:<paymentId>` in its Xero Reference and its id as Idempotency-Key; the
 *   Xero invoice's payments are checked for that marker before creating.
 * - Xero's total is compared with Track2's after every create / link / update; a difference is an
 *   error event, never hidden.
 */
import { createHash } from 'node:crypto'
import type { InvoiceTraceEvent, TraceLevel } from '@/modules/observability/invoiceTrace'
import { XeroApi, XeroError, type XeroHttpDeps } from './xeroClient'
import { XeroTokenManager, type XeroTokenState, type XeroTokenStore } from './xeroAuth'
import {
  buildXeroLines,
  centsToMajor,
  majorToCents,
  paymentMarker,
  paymentReference,
  taxLinesFor,
  toXeroInvoice,
  toXeroPayment,
  xeroLinesTotalCents,
} from './xeroMap'

export interface XeroConnectionInfo {
  id: string
  entityId: string | null
  tenantId: string
  clientId: string | null
  clientSecret: string | null
  tokens: XeroTokenState
  defaultRevenueAccountCode: string
  /** null = "do not copy payments to Xero". */
  paymentAccountCode: string | null
  salesTaxAccountCode: string | null
  populateTrackingByClient: boolean
  /** Go-live rule: only invoices sent on/after this are created in Xero. */
  cutoff: Date
}

export interface PaymentForXero {
  id: string
  amountCents: number
  paidOn: Date
  note: string | null
  xeroPaymentId: string | null
  createdAt: Date
  /** Imported from Harvest (Harvest already copied it to Xero). */
  harvestOrigin: boolean
}

export interface InvoiceForXero {
  id: string
  number: string | null
  status: string
  currency: string
  issueDate: Date | null
  dueDate: Date | null
  sentAt: Date | null
  createdAt: Date
  xeroInvoiceId: string | null
  poNumber: string | null
  totalCents: number
  discountCents: number
  discountPercent: number | null
  taxCents: number
  tax1Name: string | null
  tax1Percent: number | null
  tax2Name: string | null
  tax2Percent: number | null
  /** Imported from Harvest: may be linked by number, never created. */
  harvestOrigin: boolean
  client: {
    id: string
    name: string
    xeroContactId: string | null
    /** The stored xeroContactId belongs to this invoice's Xero org (invoice entity = client entity). */
    contactMappingTrusted: boolean
    emails: string[]
  }
  lineItems: { description: string; quantity: number; unitPriceCents: number; amountCents: number; taxable: boolean }[]
  payments: PaymentForXero[]
}

export type XeroTraceInput = Omit<InvoiceTraceEvent, 'accountId' | 'source'>

export interface XeroSyncRepo {
  saveContactId(clientId: string, contactId: string): Promise<void>
  linkInvoice(invoiceId: string, xeroInvoiceId: string): Promise<void>
  linkPayment(paymentId: string, xeroPaymentId: string): Promise<void>
  logSync(e: { entityType: 'invoice' | 'payment' | 'contact'; entityId: string; externalId?: string | null; ok: boolean; message?: string | null }): Promise<void>
  trace(e: XeroTraceInput): Promise<void>
  tokenStore(conn: XeroConnectionInfo): XeroTokenStore
  touchConnection?(connId: string): Promise<void>
}

/**
 * The Xero connection for an entity (AC-ENT-007): the entity's own row; the legacy shared row
 * (entityId null) only for the default entity or an account without entities. Another entity's
 * Xero organisation is never used.
 */
export function pickXeroConnection<T extends { entityId: string | null }>(rows: T[], entityId: string | null, defaultEntityId: string | null): T | null {
  const own = entityId ? rows.find((r) => r.entityId === entityId) : undefined
  if (own) return own
  if (!entityId || entityId === defaultEntityId) return rows.find((r) => r.entityId === null) ?? null
  return null
}

export type XeroItemResult = 'synced' | 'linked' | 'updated' | 'unchanged' | 'skipped' | 'failed'

export interface XeroPaymentOutcome {
  paymentId: string
  result: XeroItemResult
  xeroPaymentId?: string | null
  message?: string
}

export interface XeroInvoiceOutcome {
  invoiceId: string
  result: XeroItemResult
  xeroInvoiceId: string | null
  message?: string
  payments: XeroPaymentOutcome[]
}

/**
 * Idempotency-Key for a write: stable for the same Track2 record + same body (so a retry is
 * de-duplicated by Xero), new when the body changes (so a request Xero rejected — e.g. a bad account
 * code fixed since — is not answered from Xero's idempotency cache). Duplicates across different
 * bodies are prevented by the InvoiceNumber look-up and the payment Reference marker.
 */
export function idempotencyKey(prefix: string, id: string, body: unknown): string {
  return `${prefix}-${id}-${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16)}`
}

const ymd = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null)
const DEAD = new Set(['DELETED', 'VOIDED'])
const EDITABLE = new Set(['DRAFT', 'SUBMITTED', 'AUTHORISED'])
const PAYABLE = new Set(['AUTHORISED', 'PAID'])
const SYNCABLE_STATUSES = new Set(['open', 'paid'])

/** One authenticated conversation with one Xero organisation (tenant). */
export class XeroSession {
  readonly api: XeroApi
  readonly tokens: XeroTokenManager
  current: { invoiceId: string | null; paymentId: string | null } = { invoiceId: null, paymentId: null }
  authTraced = false
  /** Set after an auth failure or a rate-limit give-up: stop calling Xero for this tenant this run. */
  halted: string | null = null

  constructor(
    readonly repo: XeroSyncRepo,
    readonly conn: XeroConnectionInfo,
    http: XeroHttpDeps,
  ) {
    const httpWithEvents: XeroHttpDeps = {
      ...http,
      onEvent: async (e) => {
        await http.onEvent?.(e)
        await this.trace({
          stage: 'xero.rate_limited',
          level: 'warn',
          message: e.willRetry ? `Xero rate limit hit; retrying after ${e.retryAfterSec}s` : `Xero rate limit hit; giving up for now (retry after ${e.retryAfterSec}s)`,
          httpStatus: 429,
          detail: { retryAfterSec: e.retryAfterSec, attempt: e.attempt, willRetry: e.willRetry, problem: e.problem, method: e.method, path: e.url.replace(/^https:\/\/[^/]+/, '') },
        })
      },
    }
    this.tokens = new XeroTokenManager({
      store: repo.tokenStore(conn),
      http: httpWithEvents,
      initial: conn.tokens,
      clientId: conn.clientId,
      clientSecret: conn.clientSecret,
      tenantId: conn.tenantId,
      onRefreshed: async ({ expiresAt, byOtherRequest }) => {
        await this.trace({
          stage: 'xero.token_refreshed',
          message: byOtherRequest ? 'Xero access token was refreshed by a concurrent request; reused it' : 'Xero access token refreshed',
          detail: { expiresAt: expiresAt.toISOString(), byOtherRequest, connectionId: conn.id, entityId: conn.entityId },
        })
      },
      onAuthFailed: async (reason) => {
        this.authTraced = true
        await this.trace({ stage: 'xero.auth_failed', level: 'error', message: `Xero authorization failed — reconnect needed: ${reason}`, detail: { connectionId: conn.id, entityId: conn.entityId, tenantId: conn.tenantId } })
      },
    })
    this.api = new XeroApi(httpWithEvents, conn.tenantId, this.tokens)
  }

  async trace(e: XeroTraceInput): Promise<void> {
    await this.repo.trace({ invoiceId: this.current.invoiceId, paymentId: this.current.paymentId, ...e })
  }

  get sleep(): (ms: number) => Promise<void> {
    return this.api.http.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }
}

/** Record a failure as a trace event (by kind) + IntegrationSyncLog row. Never throws. */
async function recordFailure(s: XeroSession, entityType: 'invoice' | 'payment', entityId: string, err: unknown): Promise<string> {
  const message = (err as Error)?.message ?? String(err)
  if (err instanceof XeroError && (err.kind === 'auth' || err.kind === 'rate_limited')) s.halted = err.kind
  try {
    if (err instanceof XeroError) {
      if (err.kind === 'auth') {
        if (!s.authTraced) {
          s.authTraced = true
          await s.trace({ stage: 'xero.auth_failed', level: 'error', message: `Xero authorization failed — reconnect needed: ${message}`, httpStatus: err.status, detail: { response: err.body, tenantId: s.conn.tenantId } })
        }
      } else if (err.kind === 'rate_limited') {
        await s.trace({ stage: 'xero.rate_limited', level: 'warn', message: `${message}; left pending for retry`, httpStatus: 429, detail: { retryAfterSec: err.retryAfterSec } })
      } else if (err.kind === 'validation') {
        await s.trace({ stage: 'xero.validation_error', level: 'error', message, httpStatus: err.status, detail: { messages: err.validationMessages, response: err.body } })
      } else {
        await s.trace({ stage: 'xero.error', level: 'error', message, httpStatus: err.status, detail: { kind: err.kind, response: err.body } })
      }
    } else {
      await s.trace({ stage: 'xero.error', level: 'error', message })
    }
    await s.repo.logSync({ entityType, entityId, ok: false, message: message.slice(0, 500) })
  } catch {
    /* recording must never throw */
  }
  return message
}

function contactName(n: string) {
  return n.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Find the client's Xero contact (stored mapping → exact name → email), else create it once. */
async function resolveContact(s: XeroSession, inv: InvoiceForXero): Promise<string> {
  const c = inv.client
  if (c.xeroContactId && c.contactMappingTrusted) return c.xeroContactId
  const pick = (list: any[], match: (x: any) => boolean) => {
    const hits = list.filter(match)
    return hits.find((x) => x.ContactStatus === 'ACTIVE') ?? hits[0] ?? null
  }
  let found: any = null
  const byName = await s.api.call('GET', `/Contacts?summaryOnly=true&searchTerm=${encodeURIComponent(c.name.trim())}`)
  found = pick(byName?.Contacts ?? [], (x) => contactName(String(x.Name ?? '')) === contactName(c.name))
  for (const email of c.emails) {
    if (found) break
    const byEmail = await s.api.call('GET', `/Contacts?summaryOnly=true&searchTerm=${encodeURIComponent(email)}`)
    found = pick(byEmail?.Contacts ?? [], (x) => String(x.EmailAddress ?? '').toLowerCase() === email.toLowerCase())
  }
  let how = 'matched'
  if (!found) {
    const body: Record<string, unknown> = { Name: c.name.trim() }
    if (c.emails[0]) body.EmailAddress = c.emails[0]
    const res = await s.api.call('PUT', '/Contacts', {
      body: { Contacts: [body] },
      idempotencyKey: idempotencyKey('track2-contact', c.id, { tenant: s.conn.tenantId, body }),
      retryTransient: true,
    })
    found = res?.Contacts?.[0] ?? null
    how = 'created'
  }
  const contactId = found?.ContactID ? String(found.ContactID) : null
  if (!contactId) throw new XeroError('http', 'Xero did not return a ContactID for the client')
  if (c.contactMappingTrusted) {
    await s.repo.saveContactId(c.id, contactId)
    c.xeroContactId = contactId
  }
  await s.repo.logSync({ entityType: 'contact', entityId: c.id, externalId: contactId, ok: true, message: `Xero contact ${how}` })
  return contactId
}

/** The Xero invoice body for a Track2 invoice. Discount + tax are explicit lines (NoTax). */
export function buildInvoicePayload(inv: InvoiceForXero, conn: XeroConnectionInfo, contactId: string) {
  const lineItems = buildXeroLines({
    lines: inv.lineItems,
    discountCents: inv.discountCents,
    discountLabel: inv.discountPercent ? `Discount (${inv.discountPercent}%)` : 'Discount',
    taxes: taxLinesFor(inv),
    taxAccountCode: conn.salesTaxAccountCode,
  })
  const issue = ymd(inv.issueDate ?? inv.sentAt ?? inv.createdAt)
  const payload = toXeroInvoice({
    invoiceNumber: inv.number,
    reference: inv.poNumber ? `PO ${inv.poNumber}`.slice(0, 255) : inv.number ? `Track2 ${inv.number}` : null,
    currency: inv.currency,
    issueDateYmd: issue,
    dueDateYmd: ymd(inv.dueDate) ?? issue, // Xero requires a due date on AUTHORISED invoices
    contactId,
    defaultRevenueAccountCode: conn.defaultRevenueAccountCode,
    trackingName: conn.populateTrackingByClient ? 'Client' : null,
    trackingOption: conn.populateTrackingByClient ? inv.client.name : null,
    lineAmountTypes: 'NoTax',
    lineItems,
  })
  return { payload, linesTotalCents: xeroLinesTotalCents(lineItems) }
}

async function findByNumber(s: XeroSession, number: string): Promise<any | null> {
  const res = await s.api.call('GET', `/Invoices?InvoiceNumbers=${encodeURIComponent(number)}`)
  const hits = (res?.Invoices ?? []).filter((x: any) => x?.Type === 'ACCREC' && String(x.InvoiceNumber) === number && !DEAD.has(String(x.Status)))
  return hits[0] ?? null
}

async function getInvoice(s: XeroSession, xeroInvoiceId: string): Promise<any> {
  const res = await s.api.call('GET', `/Invoices/${encodeURIComponent(xeroInvoiceId)}`)
  const x = res?.Invoices?.[0]
  if (!x) throw new XeroError('not_found', `Xero invoice ${xeroInvoiceId} not found`)
  return x
}

/** Compare Xero's copy with Track2; trace synced (match) or total_mismatch (error). */
async function checkAgainstXero(s: XeroSession, inv: InvoiceForXero, x: any, how: string): Promise<boolean> {
  const xeroTotalCents = majorToCents(x.Total)
  const currencyOk = !x.CurrencyCode || String(x.CurrencyCode) === inv.currency
  const detail = {
    how,
    xeroInvoiceId: x.InvoiceID,
    xeroNumber: x.InvoiceNumber,
    xeroStatus: x.Status,
    xeroTotalCents,
    track2TotalCents: inv.totalCents,
    xeroCurrency: x.CurrencyCode ?? null,
    track2Currency: inv.currency,
    xeroAmountDueCents: x.AmountDue != null ? majorToCents(x.AmountDue) : null,
    xeroAmountPaidCents: x.AmountPaid != null ? majorToCents(x.AmountPaid) : null,
  }
  if (xeroTotalCents !== inv.totalCents || !currencyOk) {
    const message = `Xero total ${x.CurrencyCode ?? ''} ${(xeroTotalCents / 100).toFixed(2)} ≠ Track2 total ${inv.currency} ${(inv.totalCents / 100).toFixed(2)} (invoice ${inv.number})`
    await s.trace({ stage: 'xero.invoice_total_mismatch', level: 'error', message, externalId: x.InvoiceID, detail })
    await s.repo.logSync({ entityType: 'invoice', entityId: inv.id, externalId: x.InvoiceID, ok: false, message })
    return false
  }
  const statusOk = PAYABLE.has(String(x.Status))
  const level: TraceLevel = statusOk ? 'info' : 'warn'
  await s.trace({
    stage: 'xero.invoice_synced',
    level,
    message: `Invoice ${inv.number} ${how} in Xero (${x.Status}${statusOk ? '' : ' — expected AUTHORISED'})`,
    externalId: x.InvoiceID,
    detail,
  })
  await s.repo.logSync({ entityType: 'invoice', entityId: inv.id, externalId: x.InvoiceID, ok: true, message: `Xero invoice ${how}` })
  return true
}

/** Ensure the invoice exists in Xero exactly once. Returns the Xero invoice (or null when skipped). */
async function ensureInvoice(s: XeroSession, inv: InvoiceForXero): Promise<{ result: XeroItemResult; x: any | null; message?: string }> {
  // Already linked: compare; update only while Xero still allows edits; never create again.
  if (inv.xeroInvoiceId) {
    const x = await getInvoice(s, inv.xeroInvoiceId)
    if (DEAD.has(String(x.Status))) {
      throw new XeroError('http', `Xero invoice ${inv.xeroInvoiceId} is ${x.Status}; not re-creating it automatically (reconcile in Xero)`, { body: { Status: x.Status } })
    }
    const same = majorToCents(x.Total) === inv.totalCents && (!x.CurrencyCode || x.CurrencyCode === inv.currency)
    const editable = EDITABLE.has(String(x.Status)) && !majorToCents(x.AmountPaid) && !majorToCents(x.AmountCredited)
    if (same || !editable) {
      const ok = await checkAgainstXero(s, inv, x, 'unchanged')
      return { result: ok ? 'unchanged' : 'failed', x }
    }
    const contactId = await resolveContact(s, inv)
    const { payload, linesTotalCents } = buildInvoicePayload(inv, s.conn, contactId)
    if (!(await preflight(s, inv, linesTotalCents))) return { result: 'failed', x }
    const res = await s.api.call('POST', `/Invoices/${encodeURIComponent(inv.xeroInvoiceId)}`, {
      body: { Invoices: [{ ...payload, InvoiceID: inv.xeroInvoiceId }] },
      idempotencyKey: idempotencyKey('track2-invoice-update', inv.id, payload),
      retryTransient: true,
    })
    const updated = res?.Invoices?.[0] ?? x
    const ok = await checkAgainstXero(s, inv, updated, 'updated')
    return { result: ok ? 'updated' : 'failed', x: updated }
  }

  if (!inv.number) throw new XeroError('validation', 'Invoice has no number yet', { validationMessages: ['Invoice has no number yet'] })

  // Not linked: Xero may already have it (lost response, Harvest's copy, an earlier Track2 run).
  const existing = await findByNumber(s, inv.number)
  if (existing) {
    await s.repo.linkInvoice(inv.id, String(existing.InvoiceID))
    inv.xeroInvoiceId = String(existing.InvoiceID)
    const ok = await checkAgainstXero(s, inv, existing, 'linked')
    return { result: ok ? 'linked' : 'failed', x: existing }
  }

  const sent = inv.sentAt ?? inv.createdAt
  if (inv.harvestOrigin || sent < s.conn.cutoff) {
    const why = inv.harvestOrigin
      ? 'imported from Harvest and not found in Xero by number — Harvest copies these, Track2 never creates them'
      : `sent before the Xero cutover (${ymd(s.conn.cutoff)}) — Track2 only links these by number`
    await s.trace({ stage: 'xero.skipped', message: `Invoice ${inv.number} not created in Xero: ${why}`, detail: { reason: inv.harvestOrigin ? 'harvest_origin' : 'before_cutover', cutoff: s.conn.cutoff.toISOString() } })
    return { result: 'skipped', x: null, message: why }
  }

  const contactId = await resolveContact(s, inv)
  const { payload, linesTotalCents } = buildInvoicePayload(inv, s.conn, contactId)
  if (!(await preflight(s, inv, linesTotalCents))) return { result: 'failed', x: null, message: 'line total does not match the invoice total' }

  let x: any = null
  let how = 'created'
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await s.api.call('PUT', '/Invoices', {
        body: { Invoices: [payload] },
        idempotencyKey: idempotencyKey('track2-invoice', inv.id, payload),
        retryTransient: false, // on an uncertain failure we look up by number before retrying
      })
      x = res?.Invoices?.[0] ?? null
      break
    } catch (e) {
      // A concurrent sync created it first: Xero enforces unique invoice numbers → link to that one.
      if (e instanceof XeroError && e.kind === 'validation' && e.validationMessages.some((m) => /unique|already/i.test(m))) {
        const found = await findByNumber(s, inv.number)
        if (found) {
          x = found
          how = 'linked (created concurrently)'
          break
        }
      }
      if (!(e instanceof XeroError) || !e.uncertain) throw e
      await s.trace({ stage: 'xero.error', level: 'warn', message: `Create of invoice ${inv.number} uncertain (${e.message}); looking it up by number before retrying`, httpStatus: e.status, detail: { kind: e.kind, attempt } })
      const found = await findByNumber(s, inv.number)
      if (found) {
        x = found
        how = 'created (recovered after an uncertain response)'
        break
      }
      if (attempt >= 2) throw e
      await s.sleep(500 * 2 ** attempt)
    }
  }
  if (!x?.InvoiceID) throw new XeroError('http', 'Xero did not return an InvoiceID')
  await s.repo.linkInvoice(inv.id, String(x.InvoiceID))
  inv.xeroInvoiceId = String(x.InvoiceID)
  const ok = await checkAgainstXero(s, inv, x, how)
  return { result: ok ? 'synced' : 'failed', x }
}

/** Refuse to send lines whose total differs from the invoice total (would create a wrong invoice). */
async function preflight(s: XeroSession, inv: InvoiceForXero, linesTotalCents: number): Promise<boolean> {
  if (linesTotalCents === inv.totalCents) return true
  const message = `Not sent to Xero: mapped lines total ${(linesTotalCents / 100).toFixed(2)} ≠ Track2 total ${(inv.totalCents / 100).toFixed(2)} (invoice ${inv.number})`
  await s.trace({ stage: 'xero.invoice_total_mismatch', level: 'error', message, detail: { preflight: true, xeroTotalCents: linesTotalCents, track2TotalCents: inv.totalCents } })
  await s.repo.logSync({ entityType: 'invoice', entityId: inv.id, ok: false, message })
  return false
}

/** Copy every not-yet-copied payment of the invoice to Xero, once each. */
async function syncPayments(s: XeroSession, inv: InvoiceForXero, xeroInvoiceId: string, paymentCutoff: Date | null): Promise<XeroPaymentOutcome[]> {
  const out: XeroPaymentOutcome[] = []
  const pending = inv.payments.filter((p) => !p.xeroPaymentId).sort((a, b) => a.paidOn.getTime() - b.paidOn.getTime() || a.createdAt.getTime() - b.createdAt.getTime())
  if (!pending.length) return out
  const accountCode = s.conn.paymentAccountCode
  if (!accountCode) {
    for (const p of pending) out.push({ paymentId: p.id, result: 'skipped', message: 'payment copy is off (no payment account code)' })
    await s.trace({ stage: 'xero.skipped', message: 'Payments not copied: no Xero payment account configured ("do not copy payments")', detail: { reason: 'no_payment_account', payments: pending.length } })
    return out
  }
  const todo: PaymentForXero[] = []
  for (const p of pending) {
    if (p.harvestOrigin) out.push({ paymentId: p.id, result: 'skipped', message: 'imported from Harvest (Harvest copied it to Xero)' })
    else if (paymentCutoff && p.createdAt < paymentCutoff) out.push({ paymentId: p.id, result: 'skipped', message: 'recorded before the Xero cutover' })
    else todo.push(p)
  }
  if (!todo.length) return out

  let x: any
  try {
    x = await getInvoice(s, xeroInvoiceId)
    if (!PAYABLE.has(String(x.Status))) {
      throw new XeroError('validation', `Xero invoice is ${x.Status}; payments need an AUTHORISED invoice`, { validationMessages: [`Invoice status ${x.Status}`] })
    }
  } catch (e) {
    for (const p of todo) {
      s.current.paymentId = p.id
      out.push({ paymentId: p.id, result: 'failed', message: await recordFailure(s, 'payment', p.id, e) })
    }
    s.current.paymentId = null
    return out
  }
  let dueCents = majorToCents(x.AmountDue)
  const findMarked = (xi: any, paymentId: string) =>
    (xi?.Payments ?? []).find((xp: any) => String(xp?.Reference ?? '').includes(paymentMarker(paymentId)) && xp?.Status !== 'DELETED') ?? null

  for (const p of todo) {
    s.current.paymentId = p.id
    try {
      const already = findMarked(x, p.id)
      if (already?.PaymentID) {
        await s.repo.linkPayment(p.id, String(already.PaymentID))
        await s.trace({ stage: 'xero.payment_synced', message: `Payment already in Xero; linked (no duplicate created)`, externalId: String(already.PaymentID), detail: { how: 'linked', amountCents: majorToCents(already.Amount), track2AmountCents: p.amountCents, xeroInvoiceId } })
        await s.repo.logSync({ entityType: 'payment', entityId: p.id, externalId: String(already.PaymentID), ok: true, message: 'Xero payment linked' })
        out.push({ paymentId: p.id, result: 'linked', xeroPaymentId: String(already.PaymentID) })
        continue
      }
      if (dueCents <= 0) {
        const m = 'Xero invoice has no amount due, so this payment was not copied. Record the excess in Xero as an overpayment (or check for a duplicate payment).'
        throw new XeroError('validation', m, { validationMessages: [m] })
      }
      const amountCents = Math.min(p.amountCents, dueCents)
      const overCents = p.amountCents - amountCents
      const body = toXeroPayment({
        xeroInvoiceId,
        accountCode,
        amount: centsToMajor(amountCents),
        dateYmd: ymd(p.paidOn) as string,
        reference: paymentReference(p.id, p.note),
      })
      let xp: any = null
      let how = 'created'
      try {
        const res = await s.api.call('PUT', '/Payments', { body: { Payments: [body] }, idempotencyKey: idempotencyKey('track2-payment', p.id, body), retryTransient: true })
        xp = res?.Payments?.[0] ?? null
      } catch (e) {
        if (!(e instanceof XeroError) || !e.uncertain) throw e
        x = await getInvoice(s, xeroInvoiceId)
        xp = findMarked(x, p.id)
        if (!xp) throw e
        how = 'created (recovered after an uncertain response)'
      }
      if (!xp?.PaymentID) throw new XeroError('http', 'Xero did not return a PaymentID')
      await s.repo.linkPayment(p.id, String(xp.PaymentID))
      dueCents -= amountCents
      await s.trace({
        stage: 'xero.payment_synced',
        level: overCents > 0 ? 'warn' : 'info',
        message:
          overCents > 0
            ? `Payment copied to Xero for the ${(amountCents / 100).toFixed(2)} still due; overpayment of ${(overCents / 100).toFixed(2)} must be recorded in Xero by hand`
            : `Payment ${(amountCents / 100).toFixed(2)} ${how} in Xero`,
        externalId: String(xp.PaymentID),
        detail: { how, amountCents, track2AmountCents: p.amountCents, overpaymentCents: overCents, xeroInvoiceId, date: ymd(p.paidOn), accountCode },
      })
      await s.repo.logSync({ entityType: 'payment', entityId: p.id, externalId: String(xp.PaymentID), ok: true, message: `Xero payment ${how}` })
      if (overCents > 0) {
        await s.repo.logSync({ entityType: 'payment', entityId: p.id, externalId: String(xp.PaymentID), ok: false, message: `Overpayment of ${(overCents / 100).toFixed(2)} not copied to Xero — record it there as an overpayment` })
      }
      out.push({ paymentId: p.id, result: 'synced', xeroPaymentId: String(xp.PaymentID), message: overCents > 0 ? `overpayment ${overCents} cents not copied` : undefined })
    } catch (e) {
      out.push({ paymentId: p.id, result: 'failed', message: await recordFailure(s, 'payment', p.id, e) })
      if (e instanceof XeroError && (e.kind === 'auth' || e.kind === 'rate_limited')) break
    }
  }
  s.current.paymentId = null
  return out
}

export interface SyncInvoiceOptions {
  /** Also copy payments without a Xero id (default true). */
  includePayments?: boolean
  /** Only payments recorded on/after this are copied (syncPendingXero passes the cutover). */
  paymentCutoff?: Date | null
}

/**
 * Sync one invoice (and its pending payments) through an open session. Never throws: every failure
 * is traced + logged and returned as `failed`, and Track2's own data is never changed except for
 * storing Xero ids.
 */
export async function syncInvoiceWithSession(s: XeroSession, inv: InvoiceForXero, opts: SyncInvoiceOptions = {}): Promise<XeroInvoiceOutcome> {
  s.current = { invoiceId: inv.id, paymentId: null }
  const outcome: XeroInvoiceOutcome = { invoiceId: inv.id, result: 'skipped', xeroInvoiceId: inv.xeroInvoiceId, payments: [] }
  if (!SYNCABLE_STATUSES.has(inv.status) && !inv.xeroInvoiceId) {
    await s.trace({ stage: 'xero.skipped', message: `Invoice is ${inv.status}; only sent (open/paid) invoices are copied to Xero`, detail: { reason: 'status', status: inv.status } })
    return { ...outcome, message: `invoice is ${inv.status}` }
  }
  await s.trace({ stage: 'xero.invoice_sync_started', message: `Xero sync started for invoice ${inv.number ?? inv.id}`, detail: { tenantId: s.conn.tenantId, entityId: s.conn.entityId, linked: !!inv.xeroInvoiceId, pendingPayments: inv.payments.filter((p) => !p.xeroPaymentId).length } })
  try {
    const r = await ensureInvoice(s, inv)
    outcome.result = r.result
    outcome.message = r.message
    outcome.xeroInvoiceId = r.x?.InvoiceID ? String(r.x.InvoiceID) : inv.xeroInvoiceId
  } catch (e) {
    outcome.result = 'failed'
    outcome.message = await recordFailure(s, 'invoice', inv.id, e)
    return outcome
  }
  if ((opts.includePayments ?? true) && outcome.xeroInvoiceId) {
    outcome.payments = await syncPayments(s, inv, outcome.xeroInvoiceId, opts.paymentCutoff ?? null)
  }
  if (s.repo.touchConnection && outcome.result !== 'failed') await s.repo.touchConnection(s.conn.id).catch(() => {})
  return outcome
}
