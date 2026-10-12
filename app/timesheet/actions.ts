'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { logTime, checkLoggable } from '@/modules/time/logTime'
import { startTimer, stopTimer } from '@/modules/time/timer'
import { assertDeletable, type LockState } from '@/modules/time/timeEntry'
import { parseDurationToMinutes } from '@/modules/shared/duration'
import { parseYmd } from '@/lib/week'
import { requireUser } from '@/lib/session'
import { mayActForOnProject, resolveSubjectUserId } from '@/lib/timesheetSubject'

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

  // A project manager may log for someone only on projects they manage.
  if (!(await mayActForOnProject(current, userId, projectId))) return { error: 'You can’t log time for that person on this project.' }
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
 * Start a timer for the signed-in user, or — on a teammate's timesheet (Harvest) — for the person
 * in `forUserId`, re-authorized exactly like logTimeAction (resolveSubjectUserId, then
 * mayActForOnProject). One running timer per user still holds for the target: starting one stops
 * their previous timer, so a project manager must also be allowed on that running entry's project.
 * The top-bar forms post no `forUserId`, so the global clock stays the signed-in user's own.
 */
export async function startTimerAction(formData: FormData): Promise<void> {
  const current = await requireUser()
  const { accountId } = current
  const userId = await resolveSubjectUserId(current, formData.get('forUserId') as string | null)
  if (!userId) return
  const projectId = String(formData.get('projectId') ?? '')
  const taskId = String(formData.get('taskId') ?? '')
  const notes = String(formData.get('notes') ?? '').trim() || null
  if (!projectId || !taskId) return
  if (!(await mayActForOnProject(current, userId, projectId))) return
  if (await checkLoggable(prisma, { accountId, userId, projectId, taskId })) return // archived / not assigned
  if (userId !== current.userId) {
    const running = await prisma.timeEntry.findFirst({
      where: { accountId, userId, isRunning: true },
      select: { projectId: true },
    })
    if (running && !(await mayActForOnProject(current, userId, running.projectId))) return
  }
  const spentDate = parseYmd(String(formData.get('spentDate') ?? '')) ?? undefined
  const entry = await startTimer(prisma, { userId, projectId, taskId, now: new Date(), spentDate })
  if (notes && entry) await prisma.timeEntry.update({ where: { id: entry.id }, data: { notes } })
  revalidatePath('/timesheet')
  revalidatePath('/', 'layout') // refresh the global top-bar timer state
}

/**
 * Stop the signed-in user's running timer, or a teammate's (`forUserId`) when the actor may act
 * for them on the running entry's project (same re-authorization as logTimeAction).
 */
export async function stopTimerAction(formData: FormData): Promise<void> {
  const current = await requireUser()
  const userId = await resolveSubjectUserId(current, (formData?.get('forUserId') as string | null) ?? null)
  if (!userId) return
  if (userId !== current.userId) {
    const running = await prisma.timeEntry.findFirst({
      where: { accountId: current.accountId, userId, isRunning: true }, // tenancy (INV-5)
      select: { projectId: true },
    })
    if (!running || !(await mayActForOnProject(current, userId, running.projectId))) return
  }
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
    select: { userId: true, projectId: true, lockState: true, isRunning: true },
  })
  // Own entry, or someone the actor may act for on this project (view_edit_others_time, scope re-checked).
  if (!entry || !(await mayActForOnProject(current, entry.userId, entry.projectId))) return { error: 'Entry not found.' }
  if (entry.isRunning) return { error: 'Stop the timer before editing this entry.' }
  if (entry.lockState !== 'open') return { error: 'This entry is locked and can’t be edited.' } // INV-3

  const minutes = parseDurationToMinutes(String(formData.get('duration') ?? ''))
  if (!minutes || minutes <= 0) return { error: 'Enter a duration like 1:30, 1.5, or 90m.' }
  const notes = String(formData.get('notes') ?? '').trim() || null

  // Conditional write: if an invoice/approval locked the entry since the read above, nothing changes (INV-3).
  const { count } = await prisma.timeEntry.updateMany({
    where: { id, accountId: current.accountId, lockState: 'open', isRunning: false },
    data: { minutes, notes },
  })
  if (count === 0) return { error: 'This entry is locked and can’t be edited.' }
  revalidatePath('/timesheet')
  return { ok: true }
}

export async function deleteTimeEntryAction(formData: FormData): Promise<void> {
  const current = await requireUser()
  const id = String(formData.get('entryId') ?? '')
  if (!id) return
  const entry = await prisma.timeEntry.findFirst({
    where: { id, accountId: current.accountId }, // tenancy (INV-5)
    select: { userId: true, projectId: true, lockState: true, isRunning: true },
  })
  if (!entry || !(await mayActForOnProject(current, entry.userId, entry.projectId))) return // own entry or permitted person + project
  if (entry.isRunning && entry.userId !== current.userId) return // someone else's live timer: stop it first, then delete
  try {
    assertDeletable(entry.lockState as LockState) // approved/invoiced are immutable (INV-3)
  } catch {
    return
  }
  // Conditional delete so an entry locked since the read above is never removed (INV-3).
  await prisma.timeEntry.deleteMany({
    where: { id, accountId: current.accountId, lockState: 'open', ...(entry.userId !== current.userId ? { isRunning: false } : {}) },
  })
  revalidatePath('/timesheet')
}
