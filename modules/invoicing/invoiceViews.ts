/**
 * "Client opened the invoice" (/i/[token]) — who counts, and how often it is traced.
 *
 * Not a client view: HEAD requests, link prefetchers / unfurlers / crawlers (Slack, Google, Facebook,
 * mail-scanner previews), browser and Next.js prefetches, and signed-in Track2 users of the invoice's
 * own account (someone clicking "Preview"). Real views stamp Invoice.lastViewedAt every time, and add
 * an `invoice.viewed` trace row at most once per invoice per 30 minutes.
 */
import { userAgentFamily } from '@/modules/email/sendgridWebhook'

export const VIEW_TRACE_INTERVAL_MS = 30 * 60_000

const BOT_UA = /bot|crawler|crawl|spider|preview|slack|googlebot|facebookexternalhit|embedly|linkexpanding|whatsapp|telegram|discord|skype|curl\/|wget|python-requests|headless/i

export type ViewerKind = 'client' | 'internal' | 'bot' | 'prefetch' | 'head'

export function classifyViewer(req: {
  method?: string | null
  userAgent?: string | null
  purpose?: string | null // Purpose / Sec-Purpose / X-Purpose / X-Moz
  nextPrefetch?: boolean
  viewerAccountId?: string | null
  invoiceAccountId: string
}): ViewerKind {
  if ((req.method ?? 'GET').toUpperCase() === 'HEAD') return 'head'
  if (req.nextPrefetch || /prefetch|preview/i.test(req.purpose ?? '')) return 'prefetch'
  if (!req.userAgent || BOT_UA.test(req.userAgent)) return 'bot'
  if (req.viewerAccountId && req.viewerAccountId === req.invoiceAccountId) return 'internal'
  return 'client'
}

/** Record a new invoice.viewed row unless one was recorded in the last 30 minutes. */
export function shouldTraceView(lastViewedTraceAt: Date | null | undefined, now: Date): boolean {
  return !lastViewedTraceAt || now.getTime() - lastViewedTraceAt.getTime() >= VIEW_TRACE_INTERVAL_MS
}

/** Coarse, non-identifying detail for the trace row (no IP, no raw user-agent). */
export function viewDetail(userAgent: string | null | undefined): { userAgent: string } {
  return { userAgent: userAgentFamily(userAgent) }
}
