/**
 * Edit / delete a time entry as a service (specs/04, used by the API/MCP layer — specs/22).
 *
 * Mirrors updateTimeEntryAction / deleteTimeEntryAction (app/timesheet/actions.ts): conditional writes
 * so an entry locked since it was read is never changed (INV-3), with the audit row committed in the same
 * transaction. Additionally supports moving an entry to another project / task / date (Harvest's
 * update_time_entry): the billable flag and rate are then re-derived with resolveRate (INV-2).
 *
 * Authorization (who may act for whom, on which project; loggable checks for a new project/task) is the
 * caller's job — see lib/timesheetSubject.ts and checkLoggable.
 */
import type { PrismaClient } from '@prisma/client'
import { resolveEntryRate } from '@/modules/time/logTime'
import { timeEntryAuditData, timeEntrySnapshot } from '@/modules/time/timeAudit'

export type EditRefusal = 'not_found' | 'locked' | 'invoiced' | 'running'

export const EDIT_REFUSAL_MESSAGE: Record<EditRefusal, string> = {
  not_found: 'Time entry not found.',
  locked: 'This entry is approved or invoiced and can’t be changed.',
  invoiced: 'This entry is on an invoice (draft or sent) and can’t be changed. Remove it from the invoice first.',
  running: 'Stop the timer before editing this entry.',
}

export interface EntryPatch {
  minutes?: number
  notes?: string | null
  projectId?: string
  taskId?: string
  spentDate?: Date
}

const ENTRY_SELECT = {
  id: true,
  accountId: true,
  userId: true,
  projectId: true,
  taskId: true,
  spentDate: true,
  minutes: true,
  notes: true,
  lockState: true,
  isRunning: true,
  invoiceLineItemId: true,
} as const

/** Why an entry can't be edited, or null. Pure. */
export function editRefusal(e: { lockState: string; isRunning: boolean; invoiceLineItemId: string | null }, op: 'edit' | 'delete'): EditRefusal | null {
  if (e.lockState !== 'open') return 'locked'
  if (e.invoiceLineItemId) return 'invoiced'
  if (op === 'edit' && e.isRunning) return 'running'
  return null
}

export async function updateTimeEntry(
  prisma: PrismaClient,
  input: { accountId: string; actorUserId: string; entryId: string; patch: EntryPatch },
): Promise<{ ok: true } | { ok: false; reason: EditRefusal }> {
  const entry = await prisma.timeEntry.findFirst({ where: { id: input.entryId, accountId: input.accountId }, select: ENTRY_SELECT })
  if (!entry) return { ok: false, reason: 'not_found' }
  const refusal = editRefusal(entry, 'edit')
  if (refusal) return { ok: false, reason: refusal }

  const p = input.patch
  const projectId = p.projectId ?? entry.projectId
  const taskId = p.taskId ?? entry.taskId
  const spentDate = p.spentDate ?? entry.spentDate
  const moved = projectId !== entry.projectId || taskId !== entry.taskId || spentDate.getTime() !== entry.spentDate.getTime()
  const rate = moved ? await resolveEntryRate(prisma, { userId: entry.userId, projectId, taskId, spentDate }) : null

  const data = {
    ...(p.minutes !== undefined ? { minutes: p.minutes } : {}),
    ...(p.notes !== undefined ? { notes: p.notes } : {}),
    ...(moved ? { projectId, taskId, spentDate, isBillable: rate!.isBillable, billableRateCents: rate!.billableRateCents } : {}),
  }
  const count = await prisma.$transaction(async (tx) => {
    const { count } = await tx.timeEntry.updateMany({
      where: { id: entry.id, accountId: input.accountId, lockState: 'open', isRunning: false, invoiceLineItemId: null },
      data,
    })
    if (count > 0) {
      await tx.auditLog.create({
        data: timeEntryAuditData({
          accountId: input.accountId,
          actorUserId: input.actorUserId,
          subjectUserId: entry.userId,
          entryId: entry.id,
          event: 'updated',
          before: timeEntrySnapshot(entry),
          after: timeEntrySnapshot({ ...entry, ...data }),
        }),
      })
    }
    return count
  })
  return count > 0 ? { ok: true } : { ok: false, reason: 'locked' }
}

export async function deleteTimeEntry(
  prisma: PrismaClient,
  input: { accountId: string; actorUserId: string; entryId: string },
): Promise<{ ok: true } | { ok: false; reason: EditRefusal }> {
  const entry = await prisma.timeEntry.findFirst({ where: { id: input.entryId, accountId: input.accountId }, select: ENTRY_SELECT })
  if (!entry) return { ok: false, reason: 'not_found' }
  const refusal = editRefusal(entry, 'delete')
  if (refusal) return { ok: false, reason: refusal }
  // Someone else's live timer: stop it first (same rule as the timesheet).
  if (entry.isRunning && entry.userId !== input.actorUserId) return { ok: false, reason: 'running' }
  const count = await prisma.$transaction(async (tx) => {
    const { count } = await tx.timeEntry.deleteMany({
      where: {
        id: entry.id,
        accountId: input.accountId,
        lockState: 'open',
        invoiceLineItemId: null,
        ...(entry.userId !== input.actorUserId ? { isRunning: false } : {}),
      },
    })
    if (count > 0) {
      await tx.auditLog.create({
        data: timeEntryAuditData({
          accountId: input.accountId,
          actorUserId: input.actorUserId,
          subjectUserId: entry.userId,
          entryId: entry.id,
          event: 'deleted',
          before: timeEntrySnapshot(entry),
          after: null,
        }),
      })
    }
    return count
  })
  return count > 0 ? { ok: true } : { ok: false, reason: 'locked' }
}
