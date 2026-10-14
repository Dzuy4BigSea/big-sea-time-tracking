import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { listConnectionsWithSecrets, getConnectionWithSecrets } from '@/lib/integrations'
import { resolveAppUrl } from '@/lib/appUrl'
import { sendEmail } from '@/modules/email/send'
import { recordInvoiceEvent, type TraceSource } from '@/modules/observability/invoiceTrace'
import {
  checkSendgrid, checkStripe, checkXero, internalChecks, alertsDue, alertEmail, checkKey, summarizeResults,
  ALERT_WINDOW_MS, type CheckResult, type FetchLike, type InternalStats,
} from '@/modules/observability/healthChecks'

/**
 * Runs every billing-chain check for one or all accounts (OPS.md "Billing chain: trace, checks,
 * tests"), records one InvoiceEvent per result (stage `health.<provider>`, externalId = check key)
 * and emails account administrators about errors, at most once per 24h per check.
 *
 * Called daily from app/api/cron/timers (no extra Vercel cron entry), on demand from
 * app/api/cron/integrations-health, and by the "Run checks now" button.
 */

export interface AccountHealth {
  accountId: string
  results: CheckResult[]
  alerted: string[]
}

export interface HealthRunSummary {
  ok: boolean
  asOf: string
  totals: { total: number; ok: number; warn: number; error: number }
  accounts: AccountHealth[]
}

const LOOKBACK_DAYS = 14

async function entityNames(accountId: string): Promise<Map<string, string>> {
  const rows = await prisma.businessEntity.findMany({ where: { accountId }, select: { id: true, name: true } })
  return new Map(rows.map((r) => [r.id, r.name]))
}

async function providerChecks(accountId: string, fetchImpl: FetchLike, appUrl: string): Promise<CheckResult[]> {
  const names = await entityNames(accountId)
  const label = (id: string | null) => (id ? names.get(id) ?? id : null)
  const expectLive = process.env.VERCEL_ENV === 'production'
  const jobs: Array<Promise<CheckResult[]>> = []

  // SendGrid: one shared connection (modules/email/send.ts reads the shared row). Check every
  // sender domain in use: the connection default plus active entities' own senders.
  const sg = await getConnectionWithSecrets(accountId, 'sendgrid')
  if (sg?.status === 'connected' && sg.secrets.apiKey) {
    const entitySenders = await prisma.businessEntity.findMany({ where: { accountId, isActive: true, senderEmail: { not: null } }, select: { senderEmail: true } })
    const senderEmails = [String(sg.config.fromEmail ?? ''), ...entitySenders.map((e) => e.senderEmail ?? '')].filter(Boolean)
    jobs.push(checkSendgrid(fetchImpl, { apiKey: sg.secrets.apiKey, appUrl, senderEmails, entityId: null, entity: null }))
  }

  for (const c of await listConnectionsWithSecrets(accountId, 'stripe')) {
    if (c.status !== 'connected' || !c.secrets.secretKey) continue
    jobs.push(checkStripe(fetchImpl, { secretKey: c.secrets.secretKey, appUrl, accountId, expectLive, entityId: c.entityId, entity: label(c.entityId) }))
  }

  for (const c of await listConnectionsWithSecrets(accountId, 'xero')) {
    const tenantId = String(c.config.tenantId ?? c.externalOrgId ?? '')
    if (c.status !== 'connected' || !c.secrets.accessToken || !tenantId) continue
    jobs.push(checkXero(fetchImpl, { accessToken: c.secrets.accessToken, tenantId, hasRefreshToken: !!c.secrets.refreshToken, entityId: c.entityId, entity: label(c.entityId) }))
  }

  return (await Promise.all(jobs)).flat()
}

/** Our own trace, read in aggregate (index-backed, bounded to the last 14 days). */
export async function loadInternalStats(accountId: string, now: Date): Promise<InternalStats> {
  const since24h = new Date(now.getTime() - 24 * 3_600_000)
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)
  const hourAgo = new Date(now.getTime() - 3_600_000)

  const errors24h = await prisma.invoiceEvent.count({
    where: { accountId, level: 'error', occurredAt: { gte: since24h }, NOT: { stage: { startsWith: 'health.' } } },
  })

  // Emails the provider accepted >24h ago with no delivered/bounce/drop outcome since.
  const undelivered = await prisma.$queryRaw<Array<{ invoiceId: string; number: string | null; sentAt: Date }>>(Prisma.sql`
    SELECT s."invoiceId", i."number", max(s."occurredAt") AS "sentAt"
    FROM "InvoiceEvent" s
    JOIN "Invoice" i ON i."id" = s."invoiceId" AND i."accountId" = s."accountId"
    WHERE s."accountId" = ${accountId}
      AND s."stage" = 'email.accepted'
      AND s."occurredAt" >= ${since} AND s."occurredAt" < ${since24h}
      AND NOT EXISTS (
        SELECT 1 FROM "InvoiceEvent" d
        WHERE d."accountId" = s."accountId" AND d."invoiceId" = s."invoiceId"
          AND d."stage" IN ('email.delivered', 'email.bounced', 'email.dropped', 'email.spam_report')
          AND d."occurredAt" >= s."occurredAt"
      )
    GROUP BY s."invoiceId", i."number"
    ORDER BY "sentAt" ASC
    LIMIT 50`)

  // Payments only matter when some Xero connection copies payments (paymentAccountCode set).
  const xeroConns = await listConnectionsWithSecrets(accountId, 'xero')
  const copiesPayments = xeroConns.some((c) => c.status === 'connected' && String(c.config.paymentAccountCode ?? '').trim())
  let unsyncedPayments: InternalStats['unsyncedPayments'] = null
  if (copiesPayments) {
    unsyncedPayments = await prisma.$queryRaw<Array<{ invoiceId: string | null; paymentId: string | null; number: string | null }>>(Prisma.sql`
      SELECT p."invoiceId", p."paymentId", i."number"
      FROM "InvoiceEvent" p
      LEFT JOIN "Invoice" i ON i."id" = p."invoiceId" AND i."accountId" = p."accountId"
      LEFT JOIN "Payment" pay ON pay."id" = p."paymentId" AND pay."accountId" = p."accountId"
      WHERE p."accountId" = ${accountId}
        AND p."stage" = 'payment.recorded'
        AND p."occurredAt" >= ${since} AND p."occurredAt" < ${hourAgo}
        AND pay."xeroPaymentId" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "InvoiceEvent" x
          WHERE x."accountId" = p."accountId" AND x."stage" = 'xero.payment_synced'
            AND (x."paymentId" = p."paymentId" OR (p."paymentId" IS NULL AND x."invoiceId" = p."invoiceId"))
        )
      ORDER BY p."occurredAt" ASC
      LIMIT 50`)
  }
  return { errors24h, undelivered, unsyncedPayments }
}

async function lastAlerts(accountId: string, now: Date): Promise<Map<string, Date>> {
  const rows = await prisma.invoiceEvent.findMany({
    where: { accountId, stage: 'health.alert', occurredAt: { gte: new Date(now.getTime() - ALERT_WINDOW_MS) } },
    select: { externalId: true, occurredAt: true },
    orderBy: { occurredAt: 'desc' },
    take: 500,
  })
  const out = new Map<string, Date>()
  for (const r of rows) if (r.externalId && !out.has(r.externalId)) out.set(r.externalId, r.occurredAt)
  return out
}

async function alertAdmins(accountId: string, due: CheckResult[], appUrl: string, source: TraceSource): Promise<string[]> {
  if (!due.length) return []
  const [account, admins] = await Promise.all([
    prisma.account.findUnique({ where: { id: accountId }, select: { name: true } }),
    prisma.user.findMany({ where: { accountId, isActive: true, permissionProfile: 'administrator' }, select: { email: true } }),
  ])
  const { subject, html } = alertEmail(account?.name ?? '', due, `${appUrl}/settings/activity-log`)
  let delivered = 0
  for (const a of admins) {
    if (!a.email) continue
    // Plain-text part is required for deliverability (modules/email): derive it from the HTML.
    const text = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h[1-6]|tr)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim()
    const r = await sendEmail(accountId, { to: a.email, subject, html, text })
    if (r.ok) delivered++
  }
  // Record the alert even if email isn't configured, so we don't retry every run; the message says why.
  for (const r of due) {
    await recordInvoiceEvent({
      accountId,
      stage: 'health.alert',
      source,
      level: delivered ? 'info' : 'warn',
      message: delivered ? `Alert emailed to ${delivered} admin${delivered === 1 ? '' : 's'}: ${r.check}` : `Alert not emailed (no admin address or email not connected): ${r.check}`,
      externalId: checkKey(r),
      detail: { check: r.check, entityId: r.entityId },
    })
  }
  return due.map(checkKey)
}

/** Run every check for one account and record the results. */
export async function runAccountHealth(
  accountId: string,
  opts: { now?: Date; fetchImpl?: FetchLike; source?: TraceSource; alert?: boolean } = {},
): Promise<AccountHealth> {
  const now = opts.now ?? new Date()
  const fetchImpl = opts.fetchImpl ?? ((u, i) => fetch(u, i))
  const source = opts.source ?? 'cron'
  const appUrl = resolveAppUrl()

  const [provider, stats] = await Promise.all([
    providerChecks(accountId, fetchImpl, appUrl).catch((e): CheckResult[] => [
      { provider: 'internal', check: 'internal.runner', entityId: null, entity: null, ok: false, level: 'error', message: `Provider checks crashed: ${(e as Error)?.message ?? e}` },
    ]),
    loadInternalStats(accountId, now),
  ])
  const results = [...provider, ...internalChecks(stats, now)]

  for (const r of results) {
    await recordInvoiceEvent({
      accountId,
      stage: `health.${r.provider}`,
      source,
      level: r.level,
      message: `${r.check}${r.entity ? ` (${r.entity})` : ''}: ${r.message}`,
      externalId: checkKey(r),
      httpStatus: typeof r.details?.httpStatus === 'number' ? (r.details.httpStatus as number) : null,
      durationMs: typeof r.details?.durationMs === 'number' ? (r.details.durationMs as number) : null,
      detail: { check: r.check, entityId: r.entityId, entity: r.entity, ok: r.ok, ...(r.details ?? {}) },
    })
  }

  let alerted: string[] = []
  if (opts.alert !== false) {
    try {
      alerted = await alertAdmins(accountId, alertsDue(results, await lastAlerts(accountId, now), now), appUrl, source)
    } catch (e) {
      console.error('[health] alerting failed', (e as Error)?.message)
    }
  }
  return { accountId, results, alerted }
}

/** Every account. Never throws; a failing account becomes an error result. */
export async function runIntegrationsHealth(opts: { now?: Date; fetchImpl?: FetchLike; source?: TraceSource } = {}): Promise<HealthRunSummary> {
  const now = opts.now ?? new Date()
  const accounts = await prisma.account.findMany({ select: { id: true } })
  const out: AccountHealth[] = []
  for (const a of accounts) {
    try {
      out.push(await runAccountHealth(a.id, { ...opts, now }))
    } catch (e) {
      out.push({
        accountId: a.id,
        alerted: [],
        results: [{ provider: 'internal', check: 'internal.runner', entityId: null, entity: null, ok: false, level: 'error', message: `Health run failed: ${(e as Error)?.message ?? e}` }],
      })
    }
  }
  const totals = summarizeResults(out.flatMap((a) => a.results))
  return { ok: totals.error === 0, asOf: now.toISOString(), totals, accounts: out }
}

/** JSON-safe summary for cron responses (no details payloads). */
export function compactSummary(s: HealthRunSummary) {
  return {
    ok: s.ok,
    asOf: s.asOf,
    totals: s.totals,
    accounts: s.accounts.map((a) => ({
      accountId: a.accountId,
      alerted: a.alerted,
      results: a.results.map((r) => ({ provider: r.provider, check: r.check, entity: r.entity, level: r.level, message: r.message })),
    })),
  }
}
