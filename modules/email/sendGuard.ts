/**
 * Double-send guard for client emails (invoice / resend / reminder).
 *
 * The draft → open claim in sendInvoice already stops a double-clicked "Send invoice" from emailing
 * twice (the second request finds the invoice no longer a draft). "Resend invoice" and "Send reminder"
 * change no state, so a double click (or a retried form POST) would email the client twice. This guard
 * closes that: under a per-invoice advisory lock it looks at the invoice trace for a recent
 * `email.send_requested` of the same group that did not end in `email.rejected`, and only then
 * records a new `email.send_requested` (the claim). The lock serializes concurrent requests, so the
 * second one sees the first one's claim. A rejected send does not block an immediate retry.
 */
import { randomUUID } from 'node:crypto'
import type { TraceKind } from '@/modules/email/sendgrid'
import { toRow } from '@/modules/observability/invoiceTrace'

export const DUPLICATE_WINDOW_MS = 60_000

/** Invoice and resend mail are the same message; reminders and receipts are their own groups. */
export function sendGroup(kind: TraceKind): string {
  return kind === 'resend' ? 'invoice' : kind
}

export interface TraceRowLite {
  stage: string
  occurredAt: Date
  detail: unknown
}

const d = (r: TraceRowLite) => (r.detail ?? {}) as { sendId?: string; traceKind?: string }

/**
 * The recent claim that blocks a new send, or null. `rows` are this invoice's email.* rows from the
 * last window (any order).
 */
export function blockingSend(rows: TraceRowLite[], kind: TraceKind, now: Date, windowMs = DUPLICATE_WINDOW_MS): TraceRowLite | null {
  const group = sendGroup(kind)
  const recent = rows.filter((r) => now.getTime() - r.occurredAt.getTime() < windowMs)
  const rejected = new Set(recent.filter((r) => r.stage === 'email.rejected').map((r) => d(r).sendId).filter(Boolean))
  const claims = recent
    .filter((r) => r.stage === 'email.send_requested' && sendGroup((d(r).traceKind ?? 'invoice') as TraceKind) === group)
    .filter((r) => !rejected.has(d(r).sendId))
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
  return claims[0] ?? null
}

export type Claim = { ok: true; sendId: string } | { ok: false; secondsAgo: number }

// Minimal Prisma surface so the guard can be exercised against a real DB in integration tests.
type Tx = {
  $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>
  invoiceEvent: {
    findMany(args: unknown): Promise<TraceRowLite[]>
    create(args: unknown): Promise<unknown>
  }
}
type Db = { $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> }

/**
 * Claim the right to email `invoiceId` now. Records `email.send_requested` (the trace row the
 * provider outcome later pairs with via detail.sendId) when granted.
 */
export async function claimInvoiceEmail(
  db: Db,
  args: { accountId: string; invoiceId: string; kind: TraceKind; recipients: string[]; actorUserId?: string | null; now?: Date },
): Promise<Claim> {
  const now = args.now ?? new Date()
  return db.$transaction(async (tx) => {
    // Transaction-scoped advisory lock keyed on the invoice (released at commit; works through
    // Supabase's transaction pooler because it lives inside one transaction).
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'invoice-email:' + args.invoiceId}))::text`
    const rows = await tx.invoiceEvent.findMany({
      where: {
        accountId: args.accountId,
        invoiceId: args.invoiceId,
        source: 'app',
        stage: { in: ['email.send_requested', 'email.rejected'] },
        occurredAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) },
      },
      select: { stage: true, occurredAt: true, detail: true },
    })
    const block = blockingSend(rows, args.kind, now)
    if (block) return { ok: false as const, secondsAgo: Math.max(0, Math.round((now.getTime() - block.occurredAt.getTime()) / 1000)) }
    const sendId = randomUUID()
    await tx.invoiceEvent.create({
      data: toRow({
        accountId: args.accountId,
        invoiceId: args.invoiceId,
        stage: 'email.send_requested',
        source: 'app',
        message: `${args.kind} email requested to ${args.recipients.length} recipient${args.recipients.length === 1 ? '' : 's'}`,
        detail: { sendId, traceKind: args.kind, recipients: args.recipients, actorUserId: args.actorUserId ?? null },
        occurredAt: now,
      }),
    })
    return { ok: true as const, sendId }
  })
}
