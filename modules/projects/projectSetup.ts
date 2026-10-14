/**
 * Project setup as services (specs/03; used by the API/MCP layer — specs/22). Mirrors
 * createProjectAction / the team + task actions in app/projects/actions.ts so the same rules apply:
 * common tasks auto-added (AC-PROJ-011), the creator becomes PM, "assigned to all projects" people are
 * added, removing someone with tracked time deactivates rather than deletes.
 *
 * Authorization (manage_projects, PM scope via projectManagementScoped + managesProject) is the
 * caller's job.
 */
import type { PrismaClient, ProjectType, BillableRateMethod } from '@prisma/client'

export async function managesProject(prisma: PrismaClient, accountId: string, userId: string, projectId: string): Promise<boolean> {
  const n = await prisma.projectUserAssignment.count({ where: { accountId, projectId, userId, isProjectManager: true, isActive: true } })
  return n > 0
}

export interface NewProjectInput {
  accountId: string
  creatorUserId: string
  clientId: string
  entityId: string | null
  name: string
  code: string | null
  projectType: ProjectType
  billableRateMethod: BillableRateMethod | null
  projectHourlyRateCents: number | null
  projectFeesCents: number | null
}

export async function createProject(prisma: PrismaClient, input: NewProjectInput) {
  const { accountId } = input
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        accountId,
        clientId: input.clientId,
        name: input.name,
        code: input.code,
        projectType: input.projectType,
        billableRateMethod: input.billableRateMethod,
        projectHourlyRateCents: input.projectHourlyRateCents,
        projectFeesCents: input.projectFeesCents,
        isBillable: input.projectType !== 'non_billable',
        entityId: input.entityId,
      },
    })
    const commonTasks = await tx.task.findMany({ where: { accountId, autoAddToNewProjects: true, archivedAt: null }, select: { id: true, defaultBillable: true } })
    if (commonTasks.length > 0) {
      await tx.projectTaskAssignment.createMany({ data: commonTasks.map((t) => ({ accountId, projectId: project.id, taskId: t.id })) })
    }
    await tx.projectUserAssignment.create({ data: { accountId, projectId: project.id, userId: input.creatorUserId, isProjectManager: true } })
    const allProjectUsers = await tx.user.findMany({
      where: { accountId, assignedToAllProjects: true, id: { not: input.creatorUserId } },
      select: { id: true },
    })
    if (allProjectUsers.length > 0) {
      await tx.projectUserAssignment.createMany({
        data: allProjectUsers.map((u) => ({ accountId, projectId: project.id, userId: u.id })),
        skipDuplicates: true,
      })
    }
    return project
  })
}

/** Assign (or reactivate) a person on a project. */
export async function assignUser(prisma: PrismaClient, input: { accountId: string; projectId: string; userId: string; isProjectManager?: boolean }) {
  return prisma.projectUserAssignment.upsert({
    where: { projectId_userId: { projectId: input.projectId, userId: input.userId } },
    update: { isActive: true, ...(input.isProjectManager !== undefined ? { isProjectManager: input.isProjectManager } : {}) },
    create: { accountId: input.accountId, projectId: input.projectId, userId: input.userId, isProjectManager: !!input.isProjectManager, isActive: true },
  })
}

/** Remove a person: deactivate when they have tracked time (history preserved), else delete. False when not assigned. */
export async function unassignUser(prisma: PrismaClient, input: { accountId: string; projectId: string; userId: string }): Promise<boolean> {
  const scope = { projectId: input.projectId, userId: input.userId, accountId: input.accountId }
  const existing = await prisma.projectUserAssignment.findFirst({ where: scope, select: { isActive: true } })
  if (!existing || !existing.isActive) return false
  const hasTime = await prisma.timeEntry.findFirst({ where: scope, select: { id: true } })
  if (hasTime) await prisma.projectUserAssignment.updateMany({ where: scope, data: { isActive: false } })
  else await prisma.projectUserAssignment.deleteMany({ where: scope })
  return true
}

/** Add (or reactivate) a task on a project, billable per the task default on first add. */
export async function addTask(prisma: PrismaClient, input: { accountId: string; projectId: string; taskId: string; defaultBillable: boolean }) {
  return prisma.projectTaskAssignment.upsert({
    where: { projectId_taskId: { projectId: input.projectId, taskId: input.taskId } },
    update: { isActive: true },
    create: { accountId: input.accountId, projectId: input.projectId, taskId: input.taskId, billable: input.defaultBillable, isActive: true },
  })
}

/**
 * Remove a task from a project. Historical time entries are preserved: with tracked time the
 * assignment is deactivated (keeps its billable/rate settings), otherwise deleted. False when not assigned.
 */
export async function removeTask(prisma: PrismaClient, input: { accountId: string; projectId: string; taskId: string }): Promise<boolean> {
  const scope = { projectId: input.projectId, taskId: input.taskId, accountId: input.accountId }
  const existing = await prisma.projectTaskAssignment.findFirst({ where: scope, select: { isActive: true } })
  if (!existing || !existing.isActive) return false
  const hasTime = await prisma.timeEntry.findFirst({ where: scope, select: { id: true } })
  if (hasTime) await prisma.projectTaskAssignment.updateMany({ where: scope, data: { isActive: false } })
  else await prisma.projectTaskAssignment.deleteMany({ where: scope })
  return true
}
