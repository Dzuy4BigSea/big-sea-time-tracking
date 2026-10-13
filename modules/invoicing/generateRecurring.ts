/**
 * Recurring-invoice generation service (specs/10 §recurring).
 *
 * For each due active profile: clone its template line items into a DRAFT invoice and
 * advance nextIssueDate. A profile with an occurrence limit counts down and pauses after its last
 * invoice. Re-checks the due condition inside the transaction so a retry for the same date cannot
 * double-generate (AC-REC-003). Pure of HTTP/session concerns so it is callable from both a server
 * action and the cron route.
 *
 * Go-live hardening:
 *  - "Today" is the account's calendar day (Account.timezone), not the UTC server day.
 *  - Each profile runs in its own try/catch: one bad profile is reported, the rest still generate.
 *  - A profile that fell behind generates at most ONE invoice per run and its nextIssueDate jumps
 *    to the next future date (no backlog of one-per-missed-interval).
 *  - The invoice carries the client's business entity and each template line's `taxable` flag, and
 *    its totals come from computeTotals. (Profiles have no tax/discount columns yet; tax/discount
 *    can be added on the draft before sending.)
 */
import type { PrismaClient, PaymentTerm } from '@prisma/client'
import { afterIssue, isDue, nextFutureIssueDate } from '@/modules/invoicing/recurring'
import { computeTotals } from '@/modules/invoicing/totals'
import { todayIn } from '@/lib/tz'

interface TemplateLine {
  description: string
  quantity: number
  unitPriceCents: number
  amountCents: number
  taxable?: boolean
  /**
   * Optional project link (e.g. a Fixed Fee project). Harvest keeps issuing a recurring line linked
   * to a fixed-fee project regardless of whether the fee is exhausted, so no fee check is made here;
   * the line simply counts toward that project's invoiced amount.
   */
  linkedProjectId?: string | null
}

export interface RecurringRunSummary {
  created: number
  errors: { profileId: string; message: string }[]
}

export async function generateDueRecurring(db: PrismaClient, accountId: string, now: Date): Promise<RecurringRunSummary> {
  const account = await db.account.findUnique({ where: { id: accountId }, select: { timezone: true } })
  const asOf = todayIn(account?.timezone, now)
  const profiles = await db.recurringInvoiceProfile.findMany({ where: { accountId, status: 'active' } })
  const summary: RecurringRunSummary = { created: 0, errors: [] }

  for (const p of profiles) {
    if (!isDue(p.nextIssueDate, asOf, 'active', p.remainingOccurrences)) continue
    try {
      const client = await db.client.findFirst({ where: { id: p.clientId, accountId }, select: { currency: true, entityId: true } })
      if (!client) throw new Error('client not found')
      const lines = Array.isArray(p.templateLineItems) ? (p.templateLineItems as unknown as TemplateLine[]) : []
      if (lines.length === 0) throw new Error('profile has no template line items')
      const totals = computeTotals({ lineItems: lines.map((li) => ({ amountCents: li.amountCents, taxable: !!li.taxable })) })
      const nextDate = nextFutureIssueDate(p.nextIssueDate!, p.frequency, p.intervalCount, asOf)

      const made = await db.$transaction(async (tx) => {
        // Re-check inside the txn so a retry for the same date can't double-generate (AC-REC-003).
        const fresh = await tx.recurringInvoiceProfile.findUnique({
          where: { id: p.id },
          select: { nextIssueDate: true, status: true, remainingOccurrences: true },
        })
        if (!fresh || !isDue(fresh.nextIssueDate, asOf, fresh.status as 'active' | 'paused', fresh.remainingOccurrences)) return false
        // Claim this issue date before creating anything: advance the schedule and count down the
        // "number of invoices to issue" limit (the last one pauses the profile, BugHerd #13). The update
        // only matches the row as read, so an overlapping run (cron + manual) blocks on the row lock,
        // then matches 0 rows and issues nothing.
        const limit = afterIssue(fresh.remainingOccurrences)
        const claimed = await tx.recurringInvoiceProfile.updateMany({
          where: { id: p.id, status: 'active', nextIssueDate: fresh.nextIssueDate, remainingOccurrences: fresh.remainingOccurrences },
          data: { nextIssueDate: nextDate, remainingOccurrences: limit.remainingOccurrences, status: limit.status },
        })
        if (claimed.count === 0) return false
        const invoice = await tx.invoice.create({
          data: {
            accountId,
            clientId: p.clientId,
            entityId: client.entityId,
            status: 'draft',
            currency: client.currency ?? 'USD',
            paymentTerm: p.paymentTerm as PaymentTerm,
            subject: p.subject,
            notes: p.notes,
            subtotalCents: totals.subtotalCents,
            discountCents: totals.discountCents,
            taxCents: totals.taxCents,
            totalCents: totals.totalCents,
          },
        })
        // Keep only links to projects that still exist in this account (INV-5; templates can be stale).
        const wanted = [...new Set(lines.map((li) => li.linkedProjectId).filter((x): x is string => !!x))]
        const known = new Set(
          wanted.length ? (await tx.project.findMany({ where: { accountId, id: { in: wanted } }, select: { id: true } })).map((x) => x.id) : [],
        )
        let sortOrder = 0
        for (const li of lines) {
          await tx.invoiceLineItem.create({
            data: {
              accountId,
              invoiceId: invoice.id,
              kind: 'free_form',
              linkedProjectId: li.linkedProjectId && known.has(li.linkedProjectId) ? li.linkedProjectId : null,
              description: li.description,
              quantity: li.quantity,
              unitPriceCents: li.unitPriceCents,
              amountCents: li.amountCents,
              taxable: !!li.taxable,
              sortOrder: sortOrder++,
            },
          })
        }
        return true
      })
      if (made) summary.created++
    } catch (e) {
      summary.errors.push({ profileId: p.id, message: (e as Error)?.message?.slice(0, 300) ?? String(e) })
    }
  }
  return summary
}
