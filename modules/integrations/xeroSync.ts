import 'server-only'
import type { IntegrationConnection, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { decryptSecretMap, logSync, xeroTokenLockKey } from '@/lib/integrations'
import { encryptSecret } from '@/lib/crypto'
import { getDefaultEntity } from '@/lib/entities'
import { recordInvoiceEvent } from '@/modules/observability/invoiceTrace'
import { XeroError, type XeroHttpDeps } from './xeroClient'
import type { XeroTokenStore } from './xeroAuth'
import { resolveXeroApp } from './xeroOAuth'
import {
  XeroSession,
  pickXeroConnection,
  syncInvoiceWithSession,
  type InvoiceForXero,
  type XeroConnectionInfo,
  type XeroInvoiceOutcome,
  type XeroItemResult,
  type XeroSyncRepo,
} from './xeroSyncCore'

/**
 * Server wiring for the Xero sync (specs/14 §Xero, specs/16 AC-ENT-007, OPS.md "Xero sync"):
 * Prisma persistence, token storage, per-entity tenant routing and the pending-sync sweep.
 * The sync rules themselves live (and are unit-tested) in xeroSyncCore.ts.
 */

export interface XeroRunOptions {
  /** Wall-clock budget for Xero calls (no new attempt or wait starts after it). */
  budgetMs?: number
}

const httpDeps = (opts: XeroRunOptions = {}): XeroHttpDeps => ({
  fetch: (input, init) => fetch(input, init),
  deadline: opts.budgetMs ? Date.now() + opts.budgetMs : null,
})

// ---------------------------------------------------------------------------------------------
// Connections and routing
// ---------------------------------------------------------------------------------------------

function parseCutoff(row: IntegrationConnection, cfg: Record<string, unknown>): Date {
  const s = String(cfg.syncFromDate ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00.000Z`)
    if (!Number.isNaN(d.getTime())) return d
  }
  return row.createdAt
}

export function toConnectionInfo(row: IntegrationConnection): XeroConnectionInfo | null {
  const cfg = (row.config as Record<string, unknown> | null) ?? {}
  const secrets = decryptSecretMap(row.secretsEnc)
  const tenantId = String(cfg.tenantId ?? row.externalOrgId ?? '').trim()
  if (!tenantId) return null
  const str = (v: unknown) => (v == null ? '' : String(v).trim())
  const app = resolveXeroApp(cfg, secrets) // same resolution as "Connect to Xero", or refresh fails
  return {
    id: row.id,
    entityId: row.entityId,
    tenantId,
    clientId: app?.clientId ?? null,
    clientSecret: app?.clientSecret ?? null,
    tokens: { accessToken: secrets.accessToken || null, refreshToken: secrets.refreshToken || null, expiresAt: row.expiresAt, status: row.status },
    defaultRevenueAccountCode: str(cfg.defaultRevenueAccountCode),
    paymentAccountCode: str(cfg.paymentAccountCode) || null,
    salesTaxAccountCode: str(cfg.salesTaxAccountCode) || null,
    populateTrackingByClient: !!cfg.populateTrackingByClient,
    cutoff: parseCutoff(row, cfg),
  }
}

function tokenStore(conn: XeroConnectionInfo): XeroTokenStore {
  return {
    async withRefreshLock(fn) {
      // Advisory lock for the transaction: concurrent refreshes of this connection serialize, and the
      // rotated refresh token is written in the same transaction that read the previous one.
      return prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${xeroTokenLockKey(conn.id)}))) l`
          const row = await tx.integrationConnection.findUnique({ where: { id: conn.id } })
          if (!row) return fn({ accessToken: null, refreshToken: null, expiresAt: null, status: 'error' }, async () => {})
          const secrets = decryptSecretMap(row.secretsEnc)
          return fn(
            { accessToken: secrets.accessToken || null, refreshToken: secrets.refreshToken || null, expiresAt: row.expiresAt, status: row.status },
            async (t) => {
              const enc: Record<string, string> = { ...((row.secretsEnc as Record<string, string> | null) ?? {}), accessToken: encryptSecret(t.accessToken) }
              if (t.refreshToken) enc.refreshToken = encryptSecret(t.refreshToken)
              await tx.integrationConnection.update({ where: { id: row.id }, data: { secretsEnc: enc as Prisma.InputJsonValue, expiresAt: t.expiresAt } })
            },
          )
        },
        { maxWait: 10_000, timeout: 30_000 },
      )
    },
    async markNeedsReconnect(reason) {
      const row = await prisma.integrationConnection.findUnique({ where: { id: conn.id }, select: { config: true } })
      const cfg = (row?.config as Record<string, unknown> | null) ?? {}
      await prisma.integrationConnection.update({
        where: { id: conn.id },
        data: { status: 'error', config: { ...cfg, needsReconnect: true, lastError: reason.slice(0, 300), lastErrorAt: new Date().toISOString() } as Prisma.InputJsonValue },
      })
    },
  }
}

function prismaRepo(accountId: string): XeroSyncRepo {
  return {
    async saveContactId(clientId, contactId) {
      await prisma.client.updateMany({ where: { id: clientId, accountId }, data: { xeroContactId: contactId } })
    },
    async linkInvoice(invoiceId, xeroInvoiceId) {
      const { count } = await prisma.invoice.updateMany({
        where: { id: invoiceId, accountId, OR: [{ xeroInvoiceId: null }, { xeroInvoiceId }] },
        data: { xeroInvoiceId },
      })
      if (count === 0) {
        const cur = await prisma.invoice.findFirst({ where: { id: invoiceId, accountId }, select: { xeroInvoiceId: true } })
        throw new XeroError('http', `Invoice is already linked to Xero invoice ${cur?.xeroInvoiceId}; Xero invoice ${xeroInvoiceId} may be a duplicate — void it in Xero`)
      }
    },
    async linkPayment(paymentId, xeroPaymentId) {
      const { count } = await prisma.payment.updateMany({ where: { id: paymentId, accountId, OR: [{ xeroPaymentId: null }, { xeroPaymentId }] }, data: { xeroPaymentId } })
      if (count === 0) throw new XeroError('http', `Payment is already linked to another Xero payment; Xero payment ${xeroPaymentId} may be a duplicate`)
    },
    async logSync(e) {
      await logSync({ accountId, provider: 'xero', direction: 'outbound', entityType: e.entityType, entityId: e.entityId, externalId: e.externalId ?? null, ok: e.ok, message: e.message ?? null })
    },
    async trace(e) {
      await recordInvoiceEvent({ ...e, accountId, source: 'xero' })
    },
    tokenStore,
    async touchConnection(connId) {
      await prisma.integrationConnection.update({ where: { id: connId }, data: { lastSyncedAt: new Date() } })
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Loading invoices
// ---------------------------------------------------------------------------------------------

async function harvestOriginIds(accountId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = await prisma.migrationIdMap.findMany({
    where: { accountId, entity: { in: ['invoice', 'invoice_payment'] }, localId: { in: ids } },
    select: { localId: true },
  })
  return new Set(rows.map((r) => r.localId))
}

async function loadInvoice(accountId: string, invoiceId: string, defaultEntityId: string | null): Promise<{ inv: InvoiceForXero; entityId: string | null } | null> {
  const row = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId },
    include: {
      client: { select: { id: true, name: true, xeroContactId: true, entityId: true, contacts: { select: { email: true, isInvoiceRecipient: true } } } },
      lineItems: { orderBy: { sortOrder: 'asc' }, select: { description: true, quantity: true, unitPriceCents: true, amountCents: true, taxable: true } },
      payments: { select: { id: true, amountCents: true, paidOn: true, note: true, xeroPaymentId: true, createdAt: true } },
    },
  })
  if (!row) return null
  const harvest = await harvestOriginIds(accountId, [row.id, ...row.payments.map((p) => p.id)])
  const entityId = row.entityId ?? row.client.entityId ?? defaultEntityId
  const clientEntityId = row.client.entityId ?? defaultEntityId
  const emails = [...row.client.contacts]
    .sort((a, b) => Number(b.isInvoiceRecipient) - Number(a.isInvoiceRecipient))
    .map((c) => (c.email ?? '').trim())
    .filter((e, i, all) => e && all.indexOf(e) === i)
  const num = (v: unknown) => (v == null ? null : Number(v))
  return {
    entityId,
    inv: {
      id: row.id,
      number: row.number,
      status: row.status,
      currency: row.currency,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      sentAt: row.sentAt,
      createdAt: row.createdAt,
      xeroInvoiceId: row.xeroInvoiceId,
      poNumber: row.poNumber,
      totalCents: row.totalCents,
      discountCents: row.discountCents,
      discountPercent: num(row.discountPercent),
      taxCents: row.taxCents,
      tax1Name: row.tax1Name,
      tax1Percent: num(row.tax1Percent),
      tax2Name: row.tax2Name,
      tax2Percent: num(row.tax2Percent),
      harvestOrigin: harvest.has(row.id),
      client: {
        id: row.client.id,
        name: row.client.name,
        xeroContactId: row.client.xeroContactId,
        // Client.xeroContactId holds one id; it is only valid in the client's own entity's Xero org.
        contactMappingTrusted: entityId === clientEntityId,
        emails,
      },
      lineItems: row.lineItems.map((li) => ({ ...li, quantity: Number(li.quantity) })),
      payments: row.payments.map((p) => ({ ...p, harvestOrigin: harvest.has(p.id) })),
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

export interface XeroSyncOptions extends XeroRunOptions {
  includePayments?: boolean
  paymentCutoff?: Date | null
}

/**
 * Sync one invoice (and, by default, its payments not yet in Xero) to its entity's Xero org.
 * Never throws for Xero problems: they are traced + logged and returned as `failed`.
 */
export async function syncInvoiceToXero(accountId: string, invoiceId: string, opts: XeroSyncOptions = {}): Promise<XeroInvoiceOutcome> {
  const skipped = (message: string): XeroInvoiceOutcome => ({ invoiceId, result: 'skipped', xeroInvoiceId: null, message, payments: [] })
  const defaultEntity = await getDefaultEntity(accountId)
  const loaded = await loadInvoice(accountId, invoiceId, defaultEntity?.id ?? null)
  if (!loaded) return skipped('invoice not found')
  const rows = await prisma.integrationConnection.findMany({ where: { accountId, provider: 'xero' } })
  const row = pickXeroConnection(rows, loaded.entityId, defaultEntity?.id ?? null)
  const conn = row && row.status !== 'disconnected' ? toConnectionInfo(row) : null
  if (!conn) {
    const reason = !rows.length ? 'Xero is not connected' : !row ? "this invoice's company has no Xero organisation connected" : row.status === 'disconnected' ? 'Xero connection is incomplete' : 'Xero tenant id is missing'
    await recordInvoiceEvent({ accountId, invoiceId, source: 'xero', stage: 'xero.skipped', message: `Not copied to Xero: ${reason}`, detail: { reason, entityId: loaded.entityId } })
    return { ...skipped(reason), xeroInvoiceId: loaded.inv.xeroInvoiceId }
  }
  const session = new XeroSession(prismaRepo(accountId), conn, httpDeps(opts))
  return syncInvoiceWithSession(session, loaded.inv, { includePayments: opts.includePayments, paymentCutoff: opts.paymentCutoff })
}

/**
 * Copy a Track2 invoice to Xero (AC-XERO-001/002/003/005). Returns the Xero InvoiceID, or null when
 * not copied (not connected, skipped, failed — see the invoice trace / IntegrationSyncLog).
 */
export async function copyInvoiceToXero(accountId: string, invoiceId: string, opts: XeroSyncOptions = {}): Promise<string | null> {
  const out = await syncInvoiceToXero(accountId, invoiceId, opts)
  return out.result === 'failed' || out.result === 'skipped' ? null : out.xeroInvoiceId
}

/**
 * Copy the invoice's payments that are not in Xero yet (AC-XERO-004). Creates the Xero invoice first
 * when it is missing. Best-effort for callers: never throws.
 */
export async function copyPaymentToXero(accountId: string, invoiceId: string, opts: XeroRunOptions = {}): Promise<XeroInvoiceOutcome | null> {
  try {
    return await syncInvoiceToXero(accountId, invoiceId, { ...opts, includePayments: true })
  } catch (e) {
    await recordInvoiceEvent({ accountId, invoiceId, source: 'xero', stage: 'xero.error', level: 'error', message: `Xero payment sync crashed: ${(e as Error)?.message ?? e}` })
    await logSync({ accountId, provider: 'xero', direction: 'outbound', entityType: 'payment', entityId: invoiceId, ok: false, message: (e as Error)?.message?.slice(0, 500) })
    return null
  }
}

export interface SyncPendingXeroOptions extends XeroRunOptions {
  /** List what would be synced without calling Xero or writing anything. */
  dryRun?: boolean
  /** Max invoices handled per run (default 25; Xero allows 60 calls/minute per org). */
  limit?: number
}

export interface SyncPendingXeroItem {
  kind: 'invoice' | 'payment'
  id: string
  invoiceId: string
  number: string | null
  result: XeroItemResult | 'would_sync'
  xeroId?: string | null
  message?: string
}

export interface SyncPendingXeroSummary {
  accountId: string
  dryRun: boolean
  startedAt: string
  finishedAt: string
  connections: Array<{ connectionId: string; entityId: string | null; tenantId: string; status: string; cutoff: string; copiesPayments: boolean }>
  invoices: Record<XeroItemResult | 'pending' | 'would_sync', number>
  payments: Record<XeroItemResult | 'pending' | 'would_sync', number>
  items: SyncPendingXeroItem[]
  /** More pending work than `limit`; run again. */
  hasMore: boolean
  /** Why the run stopped early (auth failure / rate limit), if it did. */
  stoppedEarly: string | null
}

const emptyTally = (): Record<XeroItemResult | 'pending' | 'would_sync', number> => ({ pending: 0, would_sync: 0, synced: 0, linked: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 })

/**
 * Retry path for the cron / admin button: finds sent invoices without a Xero id and payments without
 * a Xero id, created after the Xero connection's cutover (config.syncFromDate, else the connection's
 * creation date) — never Harvest history — and syncs them. `dryRun` only reports.
 */
export async function syncPendingXero(accountId: string, opts: SyncPendingXeroOptions = {}): Promise<SyncPendingXeroSummary> {
  const startedAt = new Date().toISOString()
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 200))
  const summary: SyncPendingXeroSummary = {
    accountId,
    dryRun: !!opts.dryRun,
    startedAt,
    finishedAt: startedAt,
    connections: [],
    invoices: emptyTally(),
    payments: emptyTally(),
    items: [],
    hasMore: false,
    stoppedEarly: null,
  }
  const done = () => ({ ...summary, finishedAt: new Date().toISOString() })

  const rows = (await prisma.integrationConnection.findMany({ where: { accountId, provider: 'xero' } })).filter((r) => r.status !== 'disconnected')
  const conns = new Map<string, XeroConnectionInfo>()
  for (const r of rows) {
    const c = toConnectionInfo(r)
    if (!c) continue
    conns.set(r.id, c)
    summary.connections.push({ connectionId: r.id, entityId: r.entityId, tenantId: c.tenantId, status: r.status, cutoff: c.cutoff.toISOString(), copiesPayments: !!c.paymentAccountCode })
  }
  if (!conns.size) {
    summary.stoppedEarly = 'Xero is not connected'
    return done()
  }
  const minCutoff = new Date(Math.min(...[...conns.values()].map((c) => c.cutoff.getTime())))

  const [invRows, payRows] = await Promise.all([
    prisma.invoice.findMany({
      where: { accountId, status: { in: ['open', 'paid'] }, xeroInvoiceId: null, sentAt: { gte: minCutoff } },
      select: { id: true, number: true, sentAt: true },
      orderBy: { sentAt: 'asc' },
      take: limit + 1,
    }),
    prisma.payment.findMany({
      where: { accountId, xeroPaymentId: null, createdAt: { gte: minCutoff }, invoice: { status: { not: 'draft' } } },
      select: { id: true, invoiceId: true, createdAt: true, invoice: { select: { number: true } } },
      orderBy: { createdAt: 'asc' },
      take: limit + 1,
    }),
  ])
  summary.hasMore = invRows.length > limit || payRows.length > limit
  const harvest = await harvestOriginIds(accountId, [...invRows.map((r) => r.id), ...payRows.map((p) => p.id)])
  const invs = invRows.slice(0, limit).filter((r) => !harvest.has(r.id))
  const pays = payRows.slice(0, limit).filter((p) => !harvest.has(p.id))

  const invoiceIds = [...new Set([...invs.map((r) => r.id), ...pays.map((p) => p.invoiceId)])]
  if (invoiceIds.length > limit) summary.hasMore = true
  const work = invoiceIds.slice(0, limit)
  const pendingInv = new Map(invs.map((r) => [r.id, r]))
  const pendingPays = new Map<string, typeof pays>()
  for (const p of pays) pendingPays.set(p.invoiceId, [...(pendingPays.get(p.invoiceId) ?? []), p])

  const defaultEntity = await getDefaultEntity(accountId)
  const entityRows = await prisma.invoice.findMany({ where: { accountId, id: { in: work } }, select: { id: true, entityId: true, client: { select: { entityId: true } } } })
  const entityOf = new Map(entityRows.map((r) => [r.id, r.entityId ?? r.client.entityId ?? defaultEntity?.id ?? null]))
  const repo = prismaRepo(accountId)
  const sessions = new Map<string, XeroSession>()

  for (const invoiceId of work) {
    const invPending = pendingInv.get(invoiceId)
    const payPending = pendingPays.get(invoiceId) ?? []
    const number = invPending?.number ?? payPending[0]?.invoice.number ?? null
    const row = pickXeroConnection(rows, entityOf.get(invoiceId) ?? null, defaultEntity?.id ?? null)
    const conn = row ? conns.get(row.id) : undefined
    const push = (item: SyncPendingXeroItem) => {
      summary.items.push(item)
      const tally = item.kind === 'invoice' ? summary.invoices : summary.payments
      tally[item.result] += 1
    }
    if (invPending) summary.invoices.pending += 1
    summary.payments.pending += payPending.length
    if (!conn) {
      if (invPending) push({ kind: 'invoice', id: invoiceId, invoiceId, number, result: 'skipped', message: "company has no Xero organisation connected" })
      for (const p of payPending) push({ kind: 'payment', id: p.id, invoiceId, number, result: 'skipped', message: 'company has no Xero organisation connected' })
      continue
    }
    // Per-connection cutover (the query used the earliest one).
    const invEligible = !!invPending && !!invPending.sentAt && invPending.sentAt >= conn.cutoff
    const paysEligible = payPending.filter((p) => p.createdAt >= conn.cutoff)
    if (!invEligible && !paysEligible.length) {
      if (invPending) push({ kind: 'invoice', id: invoiceId, invoiceId, number, result: 'skipped', message: 'sent before the Xero cutover' })
      for (const p of payPending) push({ kind: 'payment', id: p.id, invoiceId, number, result: 'skipped', message: 'recorded before the Xero cutover' })
      continue
    }
    if (opts.dryRun) {
      if (invPending) push({ kind: 'invoice', id: invoiceId, invoiceId, number, result: invEligible ? 'would_sync' : 'skipped', message: invEligible ? undefined : 'sent before the Xero cutover' })
      for (const p of payPending) {
        const ok = paysEligible.includes(p) && !!conn.paymentAccountCode
        push({ kind: 'payment', id: p.id, invoiceId, number, result: ok ? 'would_sync' : 'skipped', message: ok ? undefined : conn.paymentAccountCode ? 'recorded before the Xero cutover' : 'payment copy is off (no payment account code)' })
      }
      continue
    }

    let session = sessions.get(conn.id)
    if (!session) {
      session = new XeroSession(repo, conn, httpDeps(opts))
      sessions.set(conn.id, session)
    }
    if (session.halted) {
      summary.stoppedEarly = `Xero ${session.halted === 'auth' ? 'needs a reconnect' : 'rate limit reached'} (tenant ${conn.tenantId})`
      if (invPending) push({ kind: 'invoice', id: invoiceId, invoiceId, number, result: 'skipped', message: summary.stoppedEarly })
      for (const p of payPending) push({ kind: 'payment', id: p.id, invoiceId, number, result: 'skipped', message: summary.stoppedEarly })
      continue
    }
    const loaded = await loadInvoice(accountId, invoiceId, defaultEntity?.id ?? null)
    if (!loaded) continue
    let out: XeroInvoiceOutcome
    try {
      out = await syncInvoiceWithSession(session, loaded.inv, { includePayments: true, paymentCutoff: conn.cutoff })
    } catch (e) {
      out = { invoiceId, result: 'failed', xeroInvoiceId: null, message: (e as Error)?.message, payments: [] }
    }
    if (invPending) push({ kind: 'invoice', id: invoiceId, invoiceId, number, result: out.result, xeroId: out.xeroInvoiceId, message: out.message })
    const payIds = new Set(payPending.map((p) => p.id))
    for (const po of out.payments) {
      if (payIds.has(po.paymentId)) push({ kind: 'payment', id: po.paymentId, invoiceId, number, result: po.result, xeroId: po.xeroPaymentId ?? null, message: po.message })
    }
    // Payments not attempted (the invoice failed / was skipped) stay pending.
    const attempted = new Set(out.payments.map((p) => p.paymentId))
    for (const p of payPending) {
      if (!attempted.has(p.id)) push({ kind: 'payment', id: p.id, invoiceId, number, result: out.result === 'failed' ? 'failed' : 'skipped', message: `invoice ${out.result}${out.message ? `: ${out.message}` : ''}` })
    }
  }
  return done()
}
