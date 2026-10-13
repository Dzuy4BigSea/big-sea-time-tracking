/**
 * logTime — create a time entry with a correctly-resolved billable rate.
 *
 * This is the first "wire pure logic to Prisma" service: it fetches the rows the
 * rate algorithm needs, calls the tested resolveRate (specs/03), and persists the entry.
 * Prisma is injected so the service is unit/integration testable against any client.
 */
import type { PrismaClient } from '@prisma/client'
import { resolveRate } from '@/modules/projects/resolveRate'
import { loggableProjectError } from '@/modules/time/actingFor'
import { timeEntryAuditData, timeEntrySnapshot } from '@/modules/time/timeAudit'

export interface LogTimeInput {
  userId: string
  projectId: string
  taskId: string
  spentDate: Date
  minutes: number
  notes?: string
  /** Who logged it (defaults to userId); differs when acting for a teammate. Audited with the create. */
  actorUserId?: string
}

export interface ResolvedEntryRate {
  accountId: string
  isBillable: boolean
  billableRateCents: number | null
}

/** Fetch rate context and resolve billable/rate for a would-be entry. Shared by logTime + timer. */
export async function resolveEntryRate(
  prisma: PrismaClient,
  ctx: { userId: string; projectId: string; taskId: string; spentDate: Date },
): Promise<ResolvedEntryRate> {
  const [project, task, taskAssignment, userAssignment, personBillableRates] = await Promise.all([
    prisma.project.findUniqueOrThrow({
      where: { id: ctx.projectId },
      select: { accountId: true, projectType: true, billableRateMethod: true, projectHourlyRateCents: true },
    }),
    prisma.task.findUniqueOrThrow({
      where: { id: ctx.taskId },
      select: { defaultBillable: true, defaultHourlyRateCents: true },
    }),
    prisma.projectTaskAssignment.findUnique({
      where: { projectId_taskId: { projectId: ctx.projectId, taskId: ctx.taskId } },
      select: { billable: true, hourlyRateCents: true },
    }),
    prisma.projectUserAssignment.findUnique({
      where: { projectId_userId: { projectId: ctx.projectId, userId: ctx.userId } },
      select: { hourlyRateCents: true },
    }),
    prisma.personBillableRate.findMany({
      where: { userId: ctx.userId },
      select: { hourlyRateCents: true, startDate: true, endDate: true },
    }),
  ])

  const rate = resolveRate({
    spentDate: ctx.spentDate,
    project: {
      projectType: project.projectType,
      billableRateMethod: project.billableRateMethod,
      projectHourlyRateCents: project.projectHourlyRateCents,
    },
    task: { defaultBillable: task.defaultBillable, defaultHourlyRateCents: task.defaultHourlyRateCents },
    taskAssignment,
    projectUserAssignment: userAssignment,
    personBillableRates,
  })

  return { accountId: project.accountId, isBillable: rate.isBillable, billableRateCents: rate.billableRateCents }
}

export async function logTime(prisma: PrismaClient, input: LogTimeInput) {
  if (!Number.isInteger(input.minutes) || input.minutes <= 0) {
    throw new Error('minutes must be a positive integer')
  }

  const { accountId, isBillable, billableRateCents } = await resolveEntryRate(prisma, {
    userId: input.userId,
    projectId: input.projectId,
    taskId: input.taskId,
    spentDate: input.spentDate,
  })

  return prisma.$transaction(async (tx) => {
    const entry = await tx.timeEntry.create({
      data: {
        accountId,
        userId: input.userId,
        projectId: input.projectId,
        taskId: input.taskId,
        spentDate: input.spentDate,
        minutes: input.minutes,
        notes: input.notes,
        isBillable,
        billableRateCents,
      },
    })
    await tx.auditLog.create({
      data: timeEntryAuditData({
        accountId,
        actorUserId: input.actorUserId ?? input.userId,
        subjectUserId: input.userId,
        entryId: entry.id,
        event: 'logged',
        before: null,
        after: timeEntrySnapshot(entry),
      }),
    })
    return entry
  })
}

/**
 * Server-side guard before new time is logged or a timer started: the project must belong to the
 * actor's account (INV-5), be active (not archived, nor its client), and the person must have an
 * active assignment to it and to the task. Returns a user-facing error, or null when OK.
 */
export async function checkLoggable(
  prisma: PrismaClient,
  ctx: { accountId: string; userId: string; projectId: string; taskId: string },
): Promise<string | null> {
  const [project, userAssignment, taskAssignment] = await Promise.all([
    prisma.project.findUnique({
      where: { id: ctx.projectId },
      select: {
        accountId: true,
        isActive: true,
        archivedAt: true,
        client: { select: { isActive: true, archivedAt: true } },
      },
    }),
    prisma.projectUserAssignment.findUnique({
      where: { projectId_userId: { projectId: ctx.projectId, userId: ctx.userId } },
      select: { isActive: true },
    }),
    prisma.projectTaskAssignment.findUnique({
      where: { projectId_taskId: { projectId: ctx.projectId, taskId: ctx.taskId } },
      select: { isActive: true, task: { select: { isActive: true } } },
    }),
  ])
  const projectError = loggableProjectError(project, ctx.accountId)
  if (projectError) return projectError
  if (!userAssignment?.isActive) return 'This person isn’t assigned to that project.'
  if (!taskAssignment?.isActive || !taskAssignment.task.isActive) return 'That task isn’t available on this project.'
  return null
}
