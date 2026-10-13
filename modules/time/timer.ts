/**
 * Timer service — start/stop a live timer (specs/04-time-tracking.md).
 *
 * Wires the tested pure helpers (startTimerPlan, computeTimerMinutes, isDuplicateStart) to Prisma.
 * The running-timer read, the stop of the previous timer and the create all happen inside one
 * transaction; the DB partial unique index one_running_timer_per_user is the final guard, and a
 * violation of it (two Starts racing, e.g. a double-click) is treated as "already running".
 * Every change writes its audit row in the same transaction.
 */
import type { PrismaClient, TimeEntry } from '@prisma/client'
import {
  startTimerPlan,
  computeTimerMinutes,
  isDuplicateStart,
  isUniqueViolation,
  isRunawayTimer,
  appendAutoStopNote,
  MAX_TIMER_MINUTES,
} from '@/modules/time/timeEntry'
import { resolveEntryRate } from '@/modules/time/logTime'
import { timeEntryAuditData, timeEntrySnapshot } from '@/modules/time/timeAudit'
import { todayIn } from '@/lib/tz'

export interface StartTimerResult {
  entry: TimeEntry
  /** True when the user already had this timer running (double-submit / race): nothing changed. */
  alreadyRunning: boolean
}

/**
 * Start a timer for the user; stops any already-running timer first (finalizing its minutes).
 * The entry is dated `spentDate` when given, else today in the account timezone.
 */
export async function startTimer(
  prisma: PrismaClient,
  input: {
    userId: string
    projectId: string
    taskId: string
    now: Date
    spentDate?: Date
    /** Account timezone (Account.timezone) used to date the entry when no spentDate is given. */
    timezone?: string | null
    notes?: string | null
    /** Who clicked Start (defaults to the timer's owner); differs when acting for a teammate. */
    actorUserId?: string
  },
): Promise<StartTimerResult> {
  // The entry is dated to the chosen day (defaults to the account's today); the timer runs live from now.
  const spentDate = input.spentDate ?? todayIn(input.timezone, input.now)
  const actorUserId = input.actorUserId ?? input.userId
  const { accountId, isBillable, billableRateCents } = await resolveEntryRate(prisma, {
    userId: input.userId,
    projectId: input.projectId,
    taskId: input.taskId,
    spentDate,
  })

  try {
    return await prisma.$transaction(async (tx) => {
      const running = await tx.timeEntry.findFirst({ where: { userId: input.userId, isRunning: true } })
      if (running && isDuplicateStart(running, input)) return { entry: running, alreadyRunning: true }

      // Stop the previous timer FIRST so the one-running-timer index is never violated. The
      // conditional update makes a concurrent stop of the same timer count only once.
      const plan = startTimerPlan(running?.timerStartedAt ? { id: running.id, timerStartedAt: running.timerStartedAt } : null, input.now)
      if (running && plan.stopEntryId) {
        const { count } = await tx.timeEntry.updateMany({
          where: { id: plan.stopEntryId, isRunning: true },
          data: { isRunning: false, timerStartedAt: null, minutes: { increment: plan.stopMinutes } },
        })
        if (count > 0) {
          await tx.auditLog.create({
            data: timeEntryAuditData({
              accountId: running.accountId,
              actorUserId,
              subjectUserId: input.userId,
              entryId: running.id,
              event: 'timer_stopped',
              before: timeEntrySnapshot(running),
              after: timeEntrySnapshot({ ...running, minutes: running.minutes + plan.stopMinutes, isRunning: false }),
            }),
          })
        }
      }

      const entry = await tx.timeEntry.create({
        data: {
          accountId,
          userId: input.userId,
          projectId: input.projectId,
          taskId: input.taskId,
          spentDate,
          minutes: 0,
          notes: input.notes || null,
          isBillable,
          billableRateCents,
          isRunning: true,
          timerStartedAt: input.now,
        },
      })
      await tx.auditLog.create({
        data: timeEntryAuditData({
          accountId,
          actorUserId,
          subjectUserId: input.userId,
          entryId: entry.id,
          event: 'timer_started',
          before: null,
          after: timeEntrySnapshot(entry),
        }),
      })
      return { entry, alreadyRunning: false }
    })
  } catch (err) {
    // A concurrent Start won the one_running_timer_per_user index: a timer is running — no-op success.
    if (!isUniqueViolation(err)) throw err
    const current = await prisma.timeEntry.findFirst({ where: { userId: input.userId, isRunning: true } })
    if (!current) throw err
    return { entry: current, alreadyRunning: true }
  }
}

/**
 * Stop the user's running timer, finalizing its minutes (capped at MAX_TIMER_MINUTES).
 * Returns null if none was running (already stopped — a double-click is a no-op).
 */
export async function stopTimer(
  prisma: PrismaClient,
  input: { userId: string; now: Date; actorUserId?: string },
): Promise<TimeEntry | null> {
  return prisma.$transaction(async (tx) => {
    const running = await tx.timeEntry.findFirst({ where: { userId: input.userId, isRunning: true } })
    if (!running?.timerStartedAt) return null

    const minutes = running.minutes + computeTimerMinutes(running.timerStartedAt, input.now)
    const { count } = await tx.timeEntry.updateMany({
      where: { id: running.id, isRunning: true },
      data: { isRunning: false, timerStartedAt: null, minutes },
    })
    if (count === 0) return null // stopped concurrently
    const stopped = { ...running, isRunning: false, timerStartedAt: null, minutes }
    await tx.auditLog.create({
      data: timeEntryAuditData({
        accountId: running.accountId,
        actorUserId: input.actorUserId ?? input.userId,
        subjectUserId: input.userId,
        entryId: running.id,
        event: 'timer_stopped',
        before: timeEntrySnapshot(running),
        after: timeEntrySnapshot(stopped),
      }),
    })
    return stopped
  })
}

/**
 * Stop every timer that has run longer than MAX_TIMER_MINUTES (all accounts): books the capped
 * minutes, appends AUTO_STOP_NOTE to the notes and writes a system audit row. Used by the
 * /api/cron/timers job. Returns how many timers were stopped.
 */
export async function autoStopRunawayTimers(prisma: PrismaClient, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - MAX_TIMER_MINUTES * 60_000)
  const runaways = await prisma.timeEntry.findMany({
    where: { isRunning: true, timerStartedAt: { lt: cutoff } },
    select: { id: true },
    take: 500,
  })
  let stopped = 0
  for (const { id } of runaways) {
    const done = await prisma.$transaction(async (tx) => {
      const e = await tx.timeEntry.findFirst({ where: { id, isRunning: true } })
      if (!e?.timerStartedAt || !isRunawayTimer(e.timerStartedAt, now)) return false
      const minutes = e.minutes + computeTimerMinutes(e.timerStartedAt, now)
      const notes = appendAutoStopNote(e.notes)
      const { count } = await tx.timeEntry.updateMany({
        where: { id, isRunning: true },
        data: { isRunning: false, timerStartedAt: null, minutes, notes },
      })
      if (count === 0) return false
      await tx.auditLog.create({
        data: timeEntryAuditData({
          accountId: e.accountId,
          actorUserId: null,
          subjectUserId: e.userId,
          entryId: e.id,
          event: 'timer_auto_stopped',
          before: timeEntrySnapshot(e),
          after: timeEntrySnapshot({ ...e, minutes, notes, isRunning: false }),
        }),
      })
      return true
    })
    if (done) stopped++
  }
  return stopped
}
