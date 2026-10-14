import 'server-only'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/session'
import { recordInvoiceEvent } from '@/modules/observability/invoiceTrace'
import { classifyViewer, shouldTraceView, viewDetail } from '@/modules/invoicing/invoiceViews'

/**
 * Called by the public invoice page (/i/[token]). Best-effort: never throws, never blocks the view.
 * Stamps lastViewedAt (AC-INV-016) and traces `invoice.viewed` (source client) for real client views.
 */
export async function recordInvoiceView(invoice: { id: string; accountId: string }, now: Date = new Date()): Promise<void> {
  try {
    const h = headers()
    const userAgent = h.get('user-agent')
    // Only consult the session when a session cookie is present (keeps the client's view cheap).
    const hasSession = /authjs\.session-token|next-auth\.session-token/.test(h.get('cookie') ?? '')
    const viewer = hasSession ? await getCurrentUser().catch(() => null) : null
    const kind = classifyViewer({
      method: h.get('x-request-method'),
      userAgent,
      purpose: [h.get('purpose'), h.get('sec-purpose'), h.get('x-purpose'), h.get('x-moz')].filter(Boolean).join(' '),
      nextPrefetch: h.has('next-router-prefetch'),
      viewerAccountId: viewer?.accountId ?? null,
      invoiceAccountId: invoice.accountId,
    })
    if (kind !== 'client') return

    await prisma.invoice.update({ where: { id: invoice.id }, data: { lastViewedAt: now } })
    const last = await prisma.invoiceEvent.findFirst({
      where: { accountId: invoice.accountId, invoiceId: invoice.id, stage: 'invoice.viewed' },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    })
    if (!shouldTraceView(last?.occurredAt, now)) return
    await recordInvoiceEvent({
      accountId: invoice.accountId,
      invoiceId: invoice.id,
      stage: 'invoice.viewed',
      source: 'client',
      message: 'Client opened the invoice',
      detail: viewDetail(userAgent),
      occurredAt: now,
    })
  } catch (e) {
    console.error('[invoice-view] not recorded', (e as Error)?.message)
  }
}
