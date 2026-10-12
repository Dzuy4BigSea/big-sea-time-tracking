'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { logTime, checkLoggable } from '@/modules/time/logTime'
import { startTimer, stopTimer } from '@/modules/time/timer'
import { assertDeletable, type LockState } from '@/modules/time/timeEntry'
import { parseDurationToMinutes } from '@/modules/shared/duration'
import { parseYmd } from '@/lib/week'
import { requireUser } from '@/lib/session'
import { mayActFor, resolveSubjectUserId } from '@/lib/timesheetSubject'

export type LogTimeState = { error?: string; ok?: boolean }

export async function logTimeAction(_prev: LogTimeState, formData: FormData): Promise<LogTimeState> {
  const current = await requireUser()
  // Whose time: the signed-in user, or (with view_edit_others_time, in scope) the person picked
  // on the timesheet switcher. The client-sent id is re-authorized here, never trusted.
  const userId = await resolveSubjectUserId(current, formData.get('forUserId') as string | null)
  if (!userId) return { error: 'You can’t log time for that person.' }
  const projectId = String(formData.get('projectId') ?? '')
  const taskId = String(formData.get('taskId') ?? '')
  const spentDate = parseYmd(String(formData.get('spentDate') ?? ''))
  const minutes = parseDurationToMinutes(String(formData.get('duration') ?? ''))
  const notes = (String(formData.get('notes') ?? '').trim() || undefined) as string | undefined

  if (!projectId || !taskId) return { error: 'Pick a project and task.' }
  if (!spentDate) return { error: 'Pick a valid date.' }
  if (!minutes || minutes <= 0) return { error: 'Enter a duration like 1:30, 1.5, or 90m.' }

  const notLoggable = await checkLoggable(prisma, { accountId: current.accountId, userId, projectId, taskId })
  if (notLoggable) return { error: notLoggable }

  try {
    await logTime(prisma, { userId, projectId, taskId, spentDate, minutes, notes })
  } catch {
    return { error: 'Could not log time. Check the project/task assignment.' }
  }

  revalidatePath('/timesheet')
  return { ok: true }
}

/**
 * Timers are always the signed-in user's own: acting for someone else on the timesheet only
 * logs/edits finished entries (any `forUserId` is ignored here), so one person's top-bar clock
 * never runs on another's behalf.
 */
export async function startTimerAction(formData: FormData): Promise<void> {
  const { userId, accountId } = await requireUser()
  const projectId = String(formData.get('projectId') ?? '')
  const taskId = String(formData.get('taskId') ?? '')
  const notes = String(formData.get('notes') ?? '').trim() || null
  if (!projectId || !taskId) return
  if (await checkLoggable(prisma, { accountId, userId, projectId, taskId })) return // archived / not assigned
  const spentDate = parseYmd(String(formData.get('spentDate') ?? '')) ?? undefined
  const entry = await startTimer(prisma, { userId, projectId, taskId, now: new Date(), spentDate })
  if (notes && entry) await prisma.timeEntry.update({ where: { id: entry.id }, data: { notes } })
  revalidatePath('/timesheet')
  revalidatePath('/', 'layout') // refresh the global top-bar timer state
}

export async function stopTimerAction(): Promise<void> {
  const { userId } = await requireUser()
  await stopTimer(prisma, { userId, now: new Date() })
  revalidatePath('/timesheet')
  revalidatePath('/', 'layout') // refresh the global top-bar timer state
}

export type EditTimeState = { error?: string; ok?: boolean }

export async function updateTimeEntryAction(_prev: EditTimeState, formData: FormData): Promise<EditTimeState> {
  const current = await requireUser()
  const id = String(formData.get('entryId') ?? '')
  if (!id) return { error: 'Missing entry.' }

  const entry = await prisma.timeEntry.findFirst({
    where: { id, accountId: current.accountId }, // tenancy (INV-5)
    select: { userId: true, lockState: true, isRunning: true },
  })
  // Own entry, or someone the actor may act for (view_edit_others_time, scope re-checked).
  if (!entry || !(await mayActFor(current, entry.userId))) return { error: 'Entry not found.' }
  if (entry.isRunning) return { error: 'Stop the timer before editing this entry.' }
  if (entry.lockState !== 'open') return { error: 'This entry is locked and can’t be edited.' } // INV-3

  const minutes = parseDurationToMinutes(String(formData.get('duration') ?? ''))
  if (!minutes || minutes <= 0) return { error: 'Enter a duration like 1:30, 1.5, or 90m.' }
  const notes = String(formData.get('notes') ?? '').trim() || null

  await prisma.timeEntry.update({ where: { id }, data: { minutes, notes } })
  revalidatePath('/timesheet')
  return { ok: true }
}

export async function deleteTimeEntryAction(formData: FormData): Promise<void> {
  const current = await requireUser()
  const id = String(formData.get('entryId') ?? '')
  if (!id) return
  const entry = await prisma.timeEntry.findFirst({
    where: { id, accountId: current.accountId }, // tenancy (INV-5)
    select: { userId: true, lockState: true, isRunning: true },
  })
  if (!entry || !(await mayActFor(current, entry.userId))) return // own entry or permitted person
  if (entry.isRunning && entry.userId !== current.userId) return // only the owner stops/discards a live timer
  try {
    assertDeletable(entry.lockState as LockState) // approved/invoiced are immutable (INV-3)
  } catch {
    return
  }
  await prisma.timeEntry.delete({ where: { id } })
  revalidatePath('/timesheet')
}
