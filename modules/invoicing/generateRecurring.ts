/**
 * Recurring-invoice generation service (specs/10 §recurring).
 *
 * For each due active profile: clone its template line items into a DRAFT invoice and
 * advance nextIssueDate by one interval. Re-checks the due condition inside the transaction
 * so a retry for the same date cannot double-generate (AC-REC-003). Pure of HTTP/session
 * concerns so it is callable from both a server action and the cron route.
 */
import type { PrismaClient, PaymentTerm } from '@prisma/client'
import { advanceIssueDate, isDue } from '@/modules/invoicing/recurring'

interface TemplateLine {
  description: string
  quantity: number
  unitPriceCents: number
  amountCents: number
}

export async function generateDueRecurring(db: PrismaClient, accountId: string, asOf: Date): Promise<number> {
  const profiles = await db.recurringInvoiceProfile.findMany({ where: { accountId, status: 'active' } })
  let created = 0
  for (const p of profiles) {
    if (!isDue(p.nextIssueDate, asOf, 'active')) continue
    const client = await db.client.findUnique({ where: { id: p.clientId }, select: { currency: true } })
    const lines = (p.templateLineItems as unknown as TemplateLine[]) ?? []
    const subtotal = lines.reduce((s, li) => s + li.amountCents, 0)
    const nextDate = advanceIssueDate(p.nextIssueDate!, p.frequency, p.intervalCount)

    await db.$transaction(async (tx) => {
      // Re-check inside the txn so a retry for the same date can't double-generate (AC-REC-003).
      const fresh = await tx.recurringInvoiceProfile.findUnique({
        where: { id: p.id },
        select: { nextIssueDate: true, status: true },
      })
      if (!fresh || !isDue(fresh.nextIssueDate, asOf, fresh.status as 'active' | 'paused')) return
      const invoice = await tx.invoice.create({
        data: {
          accountId,
          clientId: p.clientId,
          status: 'draft',
          currency: client?.currency ?? 'USD',
          paymentTerm: p.paymentTerm as PaymentTerm,
          subject: p.subject,
          notes: p.notes,
          subtotalCents: subtotal,
          totalCents: subtotal,
        },
      })
      let sortOrder = 0
      for (const li of lines) {
        await tx.invoiceLineItem.create({
          data: {
            accountId,
            invoiceId: invoice.id,
            kind: 'free_form',
            description: li.description,
            quantity: li.quantity,
            unitPriceCents: li.unitPriceCents,
            amountCents: li.amountCents,
            taxable: false,
            sortOrder: sortOrder++,
          },
        })
      }
      await tx.recurringInvoiceProfile.update({ where: { id: p.id }, data: { nextIssueDate: nextDate } })
      created++
    })
  }
  return created
}
