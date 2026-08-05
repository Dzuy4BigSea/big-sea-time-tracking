/**
 * logTime — create a time entry with a correctly-resolved billable rate.
 *
 * This is the first "wire pure logic to Prisma" service: it fetches the rows the
 * rate algorithm needs, calls the tested resolveRate (specs/03), and persists the entry.
 * Prisma is injected so the service is unit/integration testable against any client.
 */
import type { PrismaClient } from '@prisma/client'
import { resolveRate } from '@/modules/projects/resolveRate'

export interface LogTimeInput {
  userId: string
  projectId: string
  taskId: string
  spentDate: Date
  minutes: number
  notes?: string
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

  return prisma.timeEntry.create({
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
}
