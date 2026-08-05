'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { logTime } from '@/modules/time/logTime'
import { startTimer, stopTimer } from '@/modules/time/timer'
import { assertDeletable, type LockState } from '@/modules/time/timeEntry'
import { parseDurationToMinutes } from '@/modules/shared/duration'
import { parseYmd } from '@/lib/week'
import { requireUser } from '@/lib/session'

export type LogTimeState = { error?: string; ok?: boolean }

export async function logTimeAction(_prev: LogTimeState, formData: FormData): Promise<LogTimeState> {
  const { userId } = await requireUser()
  const projectId = String(formData.get('projectId') ?? '')
  const taskId = String(formData.get('taskId') ?? '')
  const spentDate = parseYmd(String(formData.get('spentDate') ?? ''))
  const minutes = parseDurationToMinutes(String(formData.get('duration') ?? ''))
  const notes = (String(formData.get('notes') ?? '').trim() || undefined) as string | undefined

  if (!projectId || !taskId) return { error: 'Pick a project and task.' }
  if (!spentDate) return { error: 'Pick a valid date.' }
  if (!minutes || minutes <= 0) return { error: 'Enter a duration like 1:30, 1.5, or 90m.' }

  try {
    await logTime(prisma, { userId, projectId, taskId, spentDate, minutes, notes })
  } catch {
    return { error: 'Could not log time. Check the project/task assignment.' }
  }

  revalidatePath('/timesheet')
  return { ok: true }
}

export async function startTimerAction(formData: FormData): Promise<void> {
  const { userId } = await requireUser()
  const projectId = String(formData.get('projectId') ?? '')
  const taskId = String(formData.get('taskId') ?? '')
  if (!projectId || !taskId) return
  await startTimer(prisma, { userId, projectId, taskId, now: new Date() })
  revalidatePath('/timesheet')
}

export async function stopTimerAction(): Promise<void> {
  const { userId } = await requireUser()
  await stopTimer(prisma, { userId, now: new Date() })
  revalidatePath('/timesheet')
}

export async function deleteTimeEntryAction(formData: FormData): Promise<void> {
  const { userId } = await requireUser()
  const id = String(formData.get('entryId') ?? '')
  if (!id) return
  const entry = await prisma.timeEntry.findUnique({ where: { id }, select: { userId: true, lockState: true } })
  if (!entry || entry.userId !== userId) return // ownership check
  try {
    assertDeletable(entry.lockState as LockState) // approved/invoiced are immutable (INV-3)
  } catch {
    return
  }
  await prisma.timeEntry.delete({ where: { id } })
  revalidatePath('/timesheet')
}
