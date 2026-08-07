/**
 * Timer service — start/stop a live timer (specs/04-time-tracking.md).
 *
 * Wires the tested pure helpers (startTimerPlan, computeTimerMinutes) to Prisma in a
 * transaction so exactly one timer runs per user (also guarded by the DB partial unique index).
 */
import type { PrismaClient } from '@prisma/client'
import { startTimerPlan, computeTimerMinutes } from '@/modules/time/timeEntry'
import { resolveEntryRate } from '@/modules/time/logTime'

const toDateOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

/** Start a timer for the user; stops any already-running timer first (finalizing its minutes). */
export async function startTimer(
  prisma: PrismaClient,
  input: { userId: string; projectId: string; taskId: string; now: Date; spentDate?: Date },
) {
  const running = await prisma.timeEntry.findFirst({
    where: { userId: input.userId, isRunning: true },
    select: { id: true, timerStartedAt: true },
  })
  const plan = startTimerPlan(
    running?.timerStartedAt ? { id: running.id, timerStartedAt: running.timerStartedAt } : null,
    input.now,
  )

  // The entry is dated to the chosen day (defaults to today); the timer still runs live from now.
  const spentDate = toDateOnly(input.spentDate ?? input.now)
  const { accountId, isBillable, billableRateCents } = await resolveEntryRate(prisma, {
    userId: input.userId,
    projectId: input.projectId,
    taskId: input.taskId,
    spentDate,
  })

  return prisma.$transaction(async (tx) => {
    // Stop the previous timer FIRST so the one-running-timer index is never violated.
    if (plan.stopEntryId) {
      await tx.timeEntry.update({
        where: { id: plan.stopEntryId },
        data: { isRunning: false, timerStartedAt: null, minutes: { increment: plan.stopMinutes } },
      })
    }
    return tx.timeEntry.create({
      data: {
        accountId,
        userId: input.userId,
        projectId: input.projectId,
        taskId: input.taskId,
        spentDate,
        minutes: 0,
        isBillable,
        billableRateCents,
        isRunning: true,
        timerStartedAt: input.now,
      },
    })
  })
}

/** Stop the user's running timer, finalizing its minutes. Returns null if none was running. */
export async function stopTimer(prisma: PrismaClient, input: { userId: string; now: Date }) {
  const running = await prisma.timeEntry.findFirst({
    where: { userId: input.userId, isRunning: true },
    select: { id: true, timerStartedAt: true, minutes: true },
  })
  if (!running?.timerStartedAt) return null

  const add = computeTimerMinutes(running.timerStartedAt, input.now)
  return prisma.timeEntry.update({
    where: { id: running.id },
    data: { isRunning: false, timerStartedAt: null, minutes: running.minutes + add },
  })
}
