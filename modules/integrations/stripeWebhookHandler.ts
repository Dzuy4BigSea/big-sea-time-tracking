/**
 * Stripe webhook core (specs/14 §2, OPS.md "Stripe payments"). DB-free: every side effect is a
 * port, so the whole decision tree is unit-tested with signed bodies (stripeWebhookHandler.test.ts)
 * and the route only wires Prisma in.
 *
 * Contract with Stripe: answer 2xx for everything we have verified and either acted on or chose
 * not to act on (Stripe retries non-2xx for 3 days, then disables the endpoint). Only two things
 * get a non-2xx: an unverifiable request (400, AC-STRIPE-004) and a transient failure while
 * recording a payment (500 → Stripe retries; recording is idempotent).
 *
 * Every step leaves an InvoiceEvent (stage names in OPS.md). Retries of one Stripe event are
 * de-duplicated by the trace store on (source, externalEventId): webhook_received uses the Stripe
 * event id; the follow-on stages use `<event id>#<stage>`, and a flag uses `flag:<payment key>` so
 * the 2–3 events Stripe sends for one payment flag it once.
 */
import type { PaymentMethod } from '@prisma/client'
import type { InvoiceTraceEvent } from '@/modules/observability/invoiceTrace'
import {
  checkStripeSignature,
  classifyStripeEvent,
  currencyMatches,
  stripeDuplicateKeys,
  stripeEventSummary,
  type SignatureFailure,
  type StripeEventFacts,
} from '@/modules/integrations/stripeWebhook'
import type { StripeRecordOutcome } from '@/modules/invoicing/recordStripePayment'

export interface WebhookInvoice {
  id: string
  status: string
  currency: string
  totalCents: number
  paidCents: number
}

export interface StripeWebhookPorts {
  nowSec(): number
  listConnections(accountId: string): Promise<Array<{ entityId: string | null; status: string; secrets: Record<string, string> }>>
  trace(e: InvoiceTraceEvent): Promise<'recorded' | 'duplicate' | 'failed'>
  findInvoice(accountId: string, by: { invoiceId: string | null; paymentIntentId: string | null }): Promise<WebhookInvoice | null>
  /** An existing payment recorded under any of `keys` (Payment.stripeChargeId), scoped to the account. */
  findPayment(accountId: string, keys: string[]): Promise<{ id: string; invoiceId: string; amountCents: number } | null>
  /** Account-calendar date for a payment that happened at `at`. */
  paidOnFor(accountId: string, at: Date): Promise<Date>
  recordPayment(input: { invoiceId: string; amountCents: number; paidOn: Date; method: PaymentMethod; key: string; paymentIntentId: string | null }): Promise<StripeRecordOutcome>
  logSync(input: { accountId: string; entityId?: string | null; externalId?: string | null; ok: boolean; message?: string | null }): Promise<void>
  audit(accountId: string, invoiceId: string, summary: string): Promise<void>
  /** Receipt email + Xero copy (best-effort; must never throw). */
  afterRecorded(accountId: string, invoiceId: string, amountCents: number, method: PaymentMethod, paidOn: Date): Promise<void>
  formatMoney(cents: number, currency: string): string
}

export interface WebhookResult {
  status: number
  body: Record<string, unknown> | string
}

const ok = (body: Record<string, unknown> = {}): WebhookResult => ({ status: 200, body: { received: true, ...body } })

const REJECT_MESSAGE: Record<SignatureFailure | 'not_connected' | 'bad_json', string> = {
  not_connected: 'Stripe webhook refused: no connected Stripe account has a webhook signing secret',
  no_secret: 'Stripe webhook refused: no signing secret configured',
  missing_header: 'Stripe webhook refused: no Stripe-Signature header',
  malformed_header: 'Stripe webhook refused: malformed Stripe-Signature header',
  timestamp_out_of_tolerance: 'Stripe webhook refused: signature timestamp outside the 5-minute tolerance (replay or clock skew)',
  no_matching_signature: 'Stripe webhook refused: signature does not match any signing secret (wrong whsec_ or tampered body)',
  bad_json: 'Stripe webhook refused: signed body is not JSON',
}

export async function handleStripeWebhook(
  ports: StripeWebhookPorts,
  req: { accountId: string; rawBody: string; signatureHeader: string | null },
): Promise<WebhookResult> {
  const { accountId, rawBody } = req

  // 1. Authenticate BEFORE parsing. Each business entity may have its own Stripe account and
  //    signing secret (specs/16); the one whose secret verifies identifies the sender.
  const conns = (await ports.listConnections(accountId)).filter((c) => c.status === 'connected' && c.secrets.webhookSecret)
  const reject = async (reason: keyof typeof REJECT_MESSAGE): Promise<WebhookResult> => {
    // No body, no header value: just why, and how big the body was.
    await ports.trace({
      accountId,
      stage: 'payment.webhook_rejected',
      source: 'stripe',
      level: 'warn',
      message: REJECT_MESSAGE[reason],
      httpStatus: 400,
      detail: { reason, bodyBytes: rawBody.length, sigHeaderPresent: !!req.signatureHeader },
    })
    return { status: 400, body: reason === 'not_connected' ? 'Stripe not connected' : 'Invalid signature' }
  }
  if (conns.length === 0) return reject('not_connected')

  const now = ports.nowSec()
  let verifiedEntityId: string | null | undefined
  let failure: SignatureFailure = 'no_matching_signature'
  for (const c of conns) {
    const r = checkStripeSignature(rawBody, req.signatureHeader, c.secrets.webhookSecret, now)
    if (r.ok) {
      verifiedEntityId = c.entityId
      break
    }
    failure = r.reason
  }
  if (verifiedEntityId === undefined) return reject(failure)

  let event: unknown
  try {
    event = JSON.parse(rawBody)
  } catch {
    return reject('bad_json')
  }

  // 2. Classify and trace receipt of every verified event (externalEventId = Stripe event id → a
  //    redelivery is recognised; processing continues because every step below is idempotent).
  const { action, facts, payment } = classifyStripeEvent(event)
  const foreignAccount = !!facts.accountId && facts.accountId !== accountId
  const evt = facts.eventId ?? `noid:${facts.type}`
  const ext = facts.paymentIntentId ?? facts.chargeId ?? facts.sessionId
  const received = await ports.trace({
    accountId,
    invoiceId: foreignAccount ? null : facts.invoiceId,
    stage: 'payment.webhook_received',
    source: 'stripe',
    message: `Stripe ${facts.type || 'event'} received → ${foreignAccount ? 'ignore (other account)' : action}`,
    externalId: ext,
    externalEventId: facts.eventId,
    occurredAt: facts.createdSec ? new Date(facts.createdSec * 1000) : undefined,
    detail: stripeEventSummary(facts, { action, entityId: verifiedEntityId }),
  })
  const redelivery = received === 'duplicate'

  if (action === 'ignore' || foreignAccount) return ok({ ignored: true })

  const stageTrace = ({ dedupe, ...e }: StageTraceInput) =>
    ports.trace({
      accountId,
      source: 'stripe',
      externalId: ext,
      ...e,
      externalEventId: dedupe ?? `${evt}#${e.stage}`,
      detail: e.detail ?? stripeEventSummary(facts),
    })
  const money = (cents: number | null) => ports.formatMoney(cents ?? 0, facts.currency ?? 'USD')

  switch (action) {
    case 'processing': {
      const inv = await ports.findInvoice(accountId, { invoiceId: facts.invoiceId, paymentIntentId: facts.paymentIntentId })
      const t = await stageTrace({
        invoiceId: inv?.id ?? null,
        stage: 'payment.processing',
        message: `Bank payment of ${money(facts.amountCents)} started; not paid until it settles (3–5 business days)`,
      })
      if (inv && t === 'recorded') await ports.audit(accountId, inv.id, `Client started a bank (ACH) payment of ${money(facts.amountCents)} via Stripe — waiting for it to clear (3–5 business days).`)
      return ok({ processing: true })
    }

    case 'failed': {
      const inv = await ports.findInvoice(accountId, { invoiceId: facts.invoiceId, paymentIntentId: facts.paymentIntentId })
      const async = facts.type === 'checkout.session.async_payment_failed'
      const t = await stageTrace({
        invoiceId: inv?.id ?? null,
        stage: 'payment.failed',
        level: 'warn',
        message: async
          ? `Bank payment of ${money(facts.amountCents)} failed to clear; invoice stays open`
          : `Online payment attempt of ${money(facts.amountCents)} failed${facts.failureCode ? ` (${facts.failureCode})` : ''}; invoice stays open`,
      })
      // A declined card inside Checkout is retried by the client on the spot; a bank debit that
      // bounces days later is something a person should follow up, so it goes on the activity log.
      if (inv && async && t === 'recorded') await ports.audit(accountId, inv.id, `Bank (ACH) payment of ${money(facts.amountCents)} via Stripe failed to clear — the invoice is still open. Follow up with the client.`)
      return ok({ failed: true })
    }

    case 'refunded':
    case 'disputed': {
      const keys = [facts.paymentIntentId, facts.chargeId].filter((k): k is string => !!k)
      const pay = keys.length ? await ports.findPayment(accountId, keys) : null
      const inv = pay ? null : await ports.findInvoice(accountId, { invoiceId: facts.invoiceId, paymentIntentId: facts.paymentIntentId })
      const invoiceId = pay?.invoiceId ?? inv?.id ?? null
      const refund = action === 'refunded'
      const what = refund
        ? `Stripe refund (${facts.status === 'fully_refunded' ? 'full' : 'partial'}) of ${money(facts.amountCents)}`
        : `Stripe dispute (${facts.status ?? 'reason unknown'}) for ${money(facts.amountCents)}`
      const t = await stageTrace({
        invoiceId,
        paymentId: pay?.id ?? null,
        stage: refund ? 'payment.refunded' : 'payment.disputed',
        level: 'error',
        message: `${what}: the invoice was NOT changed automatically — needs a person`,
      })
      if (t === 'recorded') {
        await ports.logSync({ accountId, entityId: invoiceId, externalId: facts.chargeId ?? facts.paymentIntentId, ok: false, message: `${what} — not applied automatically` })
        if (invoiceId) {
          await ports.audit(
            accountId,
            invoiceId,
            refund
              ? `${what} issued in Stripe. Track2 did not change this invoice: delete or adjust the payment if the refund should reopen the balance.`
              : `${what} opened in Stripe. Respond in the Stripe Dashboard before the deadline; Track2 did not change this invoice.`,
          )
        }
      }
      return ok({ [refund ? 'refunded' : 'disputed']: true })
    }

    case 'record':
      return recordFlow(ports, accountId, facts, payment!, { ext, redelivery, stageTrace })
  }
  return ok({ ignored: true })
}

type StageTraceInput = Omit<InvoiceTraceEvent, 'accountId' | 'source' | 'externalEventId'> & { dedupe?: string }

async function recordFlow(
  ports: StripeWebhookPorts,
  accountId: string,
  facts: StripeEventFacts,
  p: NonNullable<ReturnType<typeof classifyStripeEvent>['payment']>,
  ctx: {
    ext: string | null
    redelivery: boolean
    stageTrace: (e: StageTraceInput) => Promise<'recorded' | 'duplicate' | 'failed'>
  },
): Promise<WebhookResult> {
  const key = p.idempotencyKey!
  const amount = p.amountReceivedCents
  const amountText = ports.formatMoney(amount, p.currency)

  const invoice = await ports.findInvoice(accountId, { invoiceId: p.invoiceId, paymentIntentId: p.paymentIntentId })
  if (!invoice) {
    await ports.logSync({ accountId, externalId: key, ok: false, message: 'No matching invoice' })
    // A Stripe payment that isn't one of ours (no invoice metadata) is not our business; one that
    // names an invoice we can't find is money a person must place.
    if (p.invoiceId) {
      await ctx.stageTrace({
        stage: 'payment.flagged',
        level: 'warn',
        dedupe: `flag:${key}`,
        message: `Stripe payment of ${amountText} names invoice ${p.invoiceId}, which does not exist in this account — not applied`,
        detail: stripeEventSummary(facts, { reason: 'invoice_not_found', invoiceRef: p.invoiceId }),
      })
      return ok({ flagged: true })
    }
    return ok({ ignored: true })
  }

  // Idempotency (AC-STRIPE-003): one payment = one PaymentIntent id across every event type and
  // every redelivery; also match the charge id older rows were recorded under.
  const already = await ports.findPayment(accountId, stripeDuplicateKeys(p))
  if (already) {
    await ctx.stageTrace({
      invoiceId: invoice.id,
      paymentId: already.id,
      stage: 'payment.duplicate_ignored',
      message: `${facts.type} for a payment already recorded (${key})${ctx.redelivery ? ' — Stripe redelivery' : ''}`,
    })
    return ok({ duplicate: true })
  }

  /** Money arrived that we can't apply automatically: flag it once (per payment), ack 200. */
  const flag = async (reason: string, code: string): Promise<WebhookResult> => {
    const t = await ctx.stageTrace({
      invoiceId: invoice.id,
      stage: 'payment.flagged',
      level: 'warn',
      dedupe: `flag:${key}`,
      message: `Stripe payment of ${amountText} NOT applied: ${reason}`,
      detail: stripeEventSummary(facts, { reason: code, invoiceStatus: invoice.status, invoiceCurrency: invoice.currency, balanceCents: invoice.totalCents - invoice.paidCents }),
    })
    if (t === 'duplicate') return ok({ flagged: true, duplicate: true })
    await ports.logSync({ accountId, entityId: invoice.id, externalId: key, ok: false, message: `Unapplied Stripe payment ${key}: ${reason}`.slice(0, 500) })
    await ports.audit(accountId, invoice.id, `Stripe payment of ${amountText} received but NOT applied — ${reason}. Reconcile manually (refund or record it).`)
    return ok({ flagged: true })
  }

  if (!currencyMatches(invoice.currency, p.currency)) {
    return flag(`currency ${p.currency} does not match the invoice currency ${invoice.currency}`, 'currency_mismatch')
  }
  if (invoice.status !== 'open') {
    return flag(`invoice is ${invoice.status.replace('_', ' ')}`, `invoice_${invoice.status}`)
  }

  const paidOn = await ports.paidOnFor(accountId, facts.createdSec ? new Date(facts.createdSec * 1000) : new Date(ports.nowSec() * 1000))
  let result: StripeRecordOutcome
  try {
    result = await ports.recordPayment({ invoiceId: invoice.id, amountCents: amount, paidOn, method: p.method, key, paymentIntentId: p.paymentIntentId })
  } catch (e) {
    const msg = (e as Error)?.message?.slice(0, 200) ?? String(e)
    await ports.logSync({ accountId, entityId: invoice.id, externalId: key, ok: false, message: msg })
    // No dedupe key: each failed attempt is its own row, so retries are visible.
    await ports.trace({
      accountId,
      invoiceId: invoice.id,
      stage: 'payment.record_error',
      source: 'stripe',
      level: 'error',
      httpStatus: 500,
      externalId: ctx.ext,
      message: `Could not record Stripe payment ${key} (Stripe will retry): ${msg}`,
      detail: stripeEventSummary(facts),
    })
    return { status: 500, body: 'Could not record payment' } // transient → let Stripe retry
  }

  if (result.outcome === 'duplicate') {
    await ctx.stageTrace({ invoiceId: invoice.id, stage: 'payment.duplicate_ignored', message: `Concurrent delivery of payment ${key} lost the race; already recorded` })
    return ok({ duplicate: true })
  }
  if (result.outcome === 'not_open') return flag('invoice is no longer open', 'invoice_not_open')

  const balanceBefore = invoice.totalCents - invoice.paidCents
  await ctx.stageTrace({
    invoiceId: invoice.id,
    paymentId: result.paymentId,
    stage: 'payment.recorded',
    message: `Stripe payment of ${amountText} recorded (${p.method.replace('_', ' ')})${result.status === 'paid' ? ' — invoice paid in full' : ''}`,
    detail: stripeEventSummary(facts, { amountCents: amount, method: p.method, balanceBeforeCents: balanceBefore, invoiceStatus: result.status }),
  })
  await ports.logSync({ accountId, entityId: invoice.id, externalId: key, ok: true })
  await ports.audit(accountId, invoice.id, `Paid online via Stripe — ${amountText} (${p.method.replace('_', ' ')})`)

  const over = result.paidCents - result.totalCents
  if (over > 0) {
    await ctx.stageTrace({
      invoiceId: invoice.id,
      paymentId: result.paymentId,
      stage: 'payment.flagged',
      level: 'warn',
      dedupe: `flag:${key}`,
      message: `Overpaid by ${ports.formatMoney(over, p.currency)} via Stripe — refund or credit the client`,
      detail: stripeEventSummary(facts, { reason: 'overpayment', overCents: over }),
    })
    await ports.audit(accountId, invoice.id, `Overpaid by ${ports.formatMoney(over, p.currency)} via Stripe — refund or credit the client.`)
  }

  await ports.afterRecorded(accountId, invoice.id, amount, p.method, paidOn)
  return ok({ recorded: true })
}
