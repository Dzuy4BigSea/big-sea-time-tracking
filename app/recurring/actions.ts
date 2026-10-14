'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { PaymentTerm } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import {
  FIRST_ISSUE_DATE_ERROR,
  advanceIssueDate,
  isCompleted,
  isValidFirstIssueDate,
  parseOccurrenceLimit,
  parseSchedule,
  parseTemplateLines,
  type TemplateLineInput,
} from '@/modules/invoicing/recurring'
import { generateDueRecurring } from '@/modules/invoicing/generateRecurring'
import { parseYmd, sameDay } from '@/lib/week'
import { getAccountClock } from '@/lib/accountClock'
import { todayIn } from '@/lib/tz'

export type RecurringState = { error?: string; ok?: boolean }

const TERMS: PaymentTerm[] = ['due_on_receipt', 'net_15', 'net_30', 'net_45', 'net_60', 'custom']

async function requireInvoiceAdmin() {
  const actor = await requireUser()
  if (!can({ permissionProfile: actor.permissionProfile as PermissionProfile, permissionOverrides: actor.permissionOverrides }, 'manage_invoices')) return null
  return actor
}

/** The template fields shared by "New recurring invoice" and "Edit recurring template" (specs/27). */
function parseTemplateForm(formData: FormData) {
  const subject = String(formData.get('subject') ?? '').trim()
  const schedule = parseSchedule(formData.get('howOften'), formData.get('customN'), formData.get('customUnit'))
  const issueDate = parseYmd(String(formData.get('nextIssueDate') ?? ''))
  const remainingOccurrences = parseOccurrenceLimit(formData.get('occurrences'))
  const termRaw = String(formData.get('paymentTerm') ?? 'net_30') as PaymentTerm
  const paymentTerm = TERMS.includes(termRaw) ? termRaw : 'net_30'
  const notes = String(formData.get('notes') ?? '').trim() || null
  const extras = formData.getAll('lineMeta').map((raw) => {
    try {
      const m = JSON.parse(String(raw)) as { taxable?: unknown; linkedProjectId?: unknown }
      return { taxable: m.taxable === true, linkedProjectId: typeof m.linkedProjectId === 'string' ? m.linkedProjectId : null }
    } catch {
      return {}
    }
  })
  const lines = parseTemplateLines(formData.getAll('lineDescription'), formData.getAll('lineQuantity'), formData.getAll('lineUnitPrice'), extras)
  return { subject, schedule, issueDate, remainingOccurrences, paymentTerm, notes, lines }
}

type Parsed = ReturnType<typeof parseTemplateForm>

function validate(f: Parsed): string | null {
  if (!f.subject) return 'Subject is required.'
  if (f.schedule === 'invalid') return 'Choose how often (a custom interval is a whole number from 1 to 365).'
  if (!f.issueDate) return 'Pick the issue date.'
  if (f.remainingOccurrences === 'invalid') return 'Number of invoices must be a whole number of 1 or more (or blank to recur indefinitely).'
  if ('error' in f.lines) return f.lines.error
  return null
}

/** AC-REC-101/104/106: "+ New recurring invoice" → Save recurring invoice. */
export async function createRecurringAction(_prev: RecurringState, formData: FormData): Promise<RecurringState> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return { error: 'You do not have permission to manage recurring invoices.' }
  const clientId = String(formData.get('clientId') ?? '')
  const client = await prisma.client.findFirst({ where: { id: clientId, accountId: actor.accountId }, select: { id: true } })
  if (!client) return { error: 'Pick a client.' }
  const f = parseTemplateForm(formData)
  const err = validate(f)
  if (err) return { error: err }
  const today = todayIn((await getAccountClock(actor.accountId)).timezone)
  if (!isValidFirstIssueDate(f.issueDate, today)) return { error: FIRST_ISSUE_DATE_ERROR }
  if (f.schedule === 'invalid' || 'error' in f.lines || f.remainingOccurrences === 'invalid') return { error: 'Invalid form.' }

  try {
    await prisma.recurringInvoiceProfile.create({
      data: {
        accountId: actor.accountId,
        clientId,
        subject: f.subject,
        frequency: f.schedule.frequency,
        intervalCount: f.schedule.intervalCount,
        nextIssueDate: f.issueDate,
        anchorDay: f.issueDate!.getUTCDate(),
        amountCents: f.lines.amountCents,
        paymentTerm: f.paymentTerm,
        notes: f.notes,
        status: 'active',
        remainingOccurrences: f.remainingOccurrences,
        templateLineItems: f.lines.lines as unknown as object,
      },
    })
  } catch {
    return { error: 'Could not save the recurring invoice.' }
  }
  revalidatePath('/recurring')
  redirect('/recurring')
}

/**
 * AC-REC-105: "Edit recurring template". Changes apply to future invoices only (already generated
 * invoices are separate rows). A changed issue date must still be after today; an unchanged one
 * may already be today (it is simply due). The anchor day follows the issue date when either the
 * date or the schedule changes.
 */
export async function updateRecurringAction(_prev: RecurringState, formData: FormData): Promise<RecurringState> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return { error: 'You do not have permission to manage recurring invoices.' }
  const id = String(formData.get('id') ?? '')
  const existing = await prisma.recurringInvoiceProfile.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true, nextIssueDate: true, frequency: true, intervalCount: true, anchorDay: true, status: true },
  })
  if (!existing) return { error: 'Recurring invoice not found.' }
  const f = parseTemplateForm(formData)
  const err = validate(f)
  if (err) return { error: err }
  if (f.schedule === 'invalid' || 'error' in f.lines || f.remainingOccurrences === 'invalid') return { error: 'Invalid form.' }

  const dateChanged = !existing.nextIssueDate || !sameDay(existing.nextIssueDate, f.issueDate!)
  if (dateChanged) {
    const today = todayIn((await getAccountClock(actor.accountId)).timezone)
    if (!isValidFirstIssueDate(f.issueDate, today)) return { error: 'The next issue date must be after today.' }
  }
  const scheduleChanged = existing.frequency !== f.schedule.frequency || existing.intervalCount !== f.schedule.intervalCount
  const anchorDay = dateChanged || scheduleChanged || existing.anchorDay == null ? f.issueDate!.getUTCDate() : existing.anchorDay

  const { count } = await prisma.recurringInvoiceProfile.updateMany({
    where: { id, accountId: actor.accountId },
    data: {
      subject: f.subject,
      frequency: f.schedule.frequency,
      intervalCount: f.schedule.intervalCount,
      nextIssueDate: f.issueDate,
      anchorDay,
      amountCents: f.lines.amountCents,
      paymentTerm: f.paymentTerm,
      notes: f.notes,
      remainingOccurrences: f.remainingOccurrences,
      templateLineItems: f.lines.lines as unknown as object,
    },
  })
  if (count === 0) return { error: 'Recurring invoice not found.' }
  revalidatePath('/recurring')
  redirect('/recurring')
}

/** AC-REC-004: seed a profile from an existing invoice's line items. */
export async function createRecurringFromInvoiceAction(formData: FormData): Promise<void> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return
  const invoiceId = String(formData.get('invoiceId') ?? '')
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId: actor.accountId },
    include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!inv) return

  const templateLineItems: TemplateLineInput[] = inv.lineItems.map((li) => ({
    description: li.description,
    quantity: Number(li.quantity),
    unitPriceCents: li.unitPriceCents,
    amountCents: li.amountCents,
    ...(li.taxable ? { taxable: true } : {}),
    ...(li.linkedProjectId ? { linkedProjectId: li.linkedProjectId } : {}),
  }))
  // First issue date = one month from today in the account's timezone (always after today, AC-REC-101).
  const today = todayIn((await getAccountClock(actor.accountId)).timezone)
  const first = advanceIssueDate(today, 'monthly')

  const created = await prisma.recurringInvoiceProfile.create({
    data: {
      accountId: actor.accountId,
      clientId: inv.clientId,
      subject: inv.subject ?? 'Recurring invoice',
      frequency: 'monthly',
      intervalCount: 1,
      nextIssueDate: first,
      anchorDay: first.getUTCDate(),
      amountCents: inv.totalCents,
      paymentTerm: inv.paymentTerm,
      notes: inv.notes,
      status: 'active',
      templateLineItems: templateLineItems as unknown as object,
    },
    select: { id: true },
  })
  revalidatePath('/recurring')
  // Open the new template so the schedule can be reviewed (Harvest: edit before saving).
  redirect(`/recurring/${created.id}/edit`)
}

export async function generateDueAction(): Promise<void> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return
  await generateDueRecurring(prisma, actor.accountId, new Date())
  revalidatePath('/recurring')
  revalidatePath('/invoices')
}

export async function toggleRecurringStatusAction(formData: FormData): Promise<void> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const p = await prisma.recurringInvoiceProfile.findFirst({
    where: { id, accountId: actor.accountId },
    select: { status: true, remainingOccurrences: true },
  })
  if (!p) return
  // A completed profile (issue limit used up) can't resume until it is given more invoices to issue.
  if (p.status === 'paused' && isCompleted(p.remainingOccurrences)) return
  await prisma.recurringInvoiceProfile.updateMany({
    where: { id, accountId: actor.accountId },
    data: { status: p.status === 'active' ? 'paused' : 'active' },
  })
  revalidatePath('/recurring')
}

/**
 * Set how many more invoices a profile issues (BugHerd #13). Blank = recur indefinitely.
 * Giving a completed profile more occurrences leaves it paused; the user resumes it explicitly.
 */
export async function updateRecurringLimitAction(_prev: RecurringState, formData: FormData): Promise<RecurringState> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return { error: 'You do not have permission to manage recurring invoices.' }
  const id = String(formData.get('id') ?? '')
  const remainingOccurrences = parseOccurrenceLimit(formData.get('occurrences'))
  if (remainingOccurrences === 'invalid') return { error: 'Enter a whole number of 1 or more, or leave blank.' }
  const { count } = await prisma.recurringInvoiceProfile.updateMany({
    where: { id, accountId: actor.accountId },
    data: { remainingOccurrences },
  })
  if (count === 0) return { error: 'Recurring profile not found.' }
  revalidatePath('/recurring')
  return { ok: true }
}

export async function deleteRecurringAction(formData: FormData): Promise<void> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  await prisma.recurringInvoiceProfile.deleteMany({ where: { id, accountId: actor.accountId } })
  revalidatePath('/recurring')
  if (formData.get('redirect') === '1') redirect('/recurring')
}
