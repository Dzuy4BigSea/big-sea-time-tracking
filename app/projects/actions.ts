'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ProjectType, BillableRateMethod, BudgetMethod } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, projectManagementScoped, type Capability, type PermissionProfile } from '@/modules/shared/permissions'
import { validEntityId } from '@/lib/entities'
import { normalizeProjectNotes } from '@/modules/projects/notes'

export type NewProjectState = { error?: string }
export type EditProjectState = { error?: string; ok?: boolean }

const centsFrom = (raw: FormDataEntryValue | null): number | null => {
  const n = Number(String(raw ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
}

export async function createProjectAction(_prev: NewProjectState, formData: FormData): Promise<NewProjectState> {
  const { userId, accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_projects')) {
    return { error: 'You do not have permission to add projects.' }
  }

  const clientId = String(formData.get('clientId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const code = String(formData.get('code') ?? '').trim() || null
  const projectType = String(formData.get('projectType') ?? 'time_and_materials') as ProjectType
  const billableRateMethodRaw = String(formData.get('billableRateMethod') ?? 'none') as BillableRateMethod
  const budgetChoice = String(formData.get('budgetMethod') ?? 'none') // none | hours_total | fee_total

  if (!name) return { error: 'Project name is required.' }
  const notesResult = normalizeProjectNotes(String(formData.get('notes') ?? ''))
  if ('error' in notesResult) return { error: notesResult.error }
  const client = await prisma.client.findFirst({ where: { id: clientId, accountId }, select: { id: true, entityId: true } })
  if (!client) return { error: 'Pick a valid client.' }
  // Entity: explicit choice, else inherit the client's designation (specs/16).
  const entityId = (await validEntityId(accountId, String(formData.get('entityId') ?? ''))) ?? client.entityId

  const isTM = projectType === 'time_and_materials'
  const billableRateMethod = isTM ? billableRateMethodRaw : null
  const projectHourlyRateCents = isTM && billableRateMethod === 'project' ? centsFrom(formData.get('projectRate')) : null
  const projectFeesCents = projectType === 'fixed_fee' ? centsFrom(formData.get('projectFees')) : null

  let budgetMethod: BudgetMethod = 'none'
  let budgetValue: number | null = null
  if (budgetChoice === 'hours_total') {
    budgetMethod = 'hours_total'
    const hrs = Number(String(formData.get('budgetHours') ?? ''))
    budgetValue = Number.isFinite(hrs) && hrs > 0 ? Math.round(hrs * 60) : null
  } else if (budgetChoice === 'fee_total') {
    budgetMethod = 'fee_total'
    budgetValue = centsFrom(formData.get('budgetFee'))
  }
  const budgetResetsMonthly = formData.get('budgetResetsMonthly') === 'on'
  const alertRaw = Number(String(formData.get('budgetAlertPercent') ?? ''))
  const budgetAlertPercent = Number.isFinite(alertRaw) && alertRaw > 0 ? Math.round(alertRaw) : null

  let projectId: string
  try {
    const project = await prisma.project.create({
      data: {
        accountId,
        clientId,
        name,
        code,
        projectType,
        billableRateMethod,
        projectHourlyRateCents,
        projectFeesCents,
        budgetMethod,
        budgetValue,
        budgetResetsMonthly,
        budgetAlertPercent,
        isBillable: projectType !== 'non_billable',
        entityId,
        notes: notesResult.notes,
      },
    })
    projectId = project.id

    // Auto-assign "Common" tasks (AC-PROJ-011) and add the creator as PM.
    const commonTasks = await prisma.task.findMany({
      where: { accountId, autoAddToNewProjects: true, archivedAt: null },
      select: { id: true },
    })
    if (commonTasks.length > 0) {
      await prisma.projectTaskAssignment.createMany({
        data: commonTasks.map((t) => ({ accountId, projectId, taskId: t.id })),
      })
    }
    await prisma.projectUserAssignment.create({
      data: { accountId, projectId, userId, isProjectManager: true },
    })

    // Honor "assigned to all projects" people (specs/17) — auto-add them to this new project.
    const allProjectUsers = await prisma.user.findMany({
      where: { accountId, assignedToAllProjects: true, id: { not: userId } },
      select: { id: true },
    })
    if (allProjectUsers.length > 0) {
      await prisma.projectUserAssignment.createMany({
        data: allProjectUsers.map((u) => ({ accountId, projectId, userId: u.id })),
        skipDuplicates: true,
      })
    }
  } catch {
    return { error: 'Could not create the project.' }
  }

  revalidatePath('/projects')
  redirect(`/projects/${projectId}`) // NEXT_REDIRECT — outside try/catch
}

export async function updateProjectAction(_prev: EditProjectState, formData: FormData): Promise<EditProjectState> {
  const { userId, accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_projects')) {
    return { error: 'You do not have permission to edit projects.' }
  }

  const id = String(formData.get('id') ?? '')
  const project = await prisma.project.findFirst({ where: { id, accountId }, select: { id: true } })
  if (!project) return { error: 'Project not found.' }
  if (
    projectManagementScoped({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }) &&
    !(await managesProject(accountId, userId, id))
  ) {
    return { error: 'You can only edit projects you manage.' }
  }
  const entityId = await validEntityId(accountId, String(formData.get('entityId') ?? ''))

  const name = String(formData.get('name') ?? '').trim()
  const code = String(formData.get('code') ?? '').trim() || null
  const projectType = String(formData.get('projectType') ?? 'time_and_materials') as ProjectType
  const billableRateMethodRaw = String(formData.get('billableRateMethod') ?? 'none') as BillableRateMethod
  const budgetChoice = String(formData.get('budgetMethod') ?? 'none')

  if (!name) return { error: 'Project name is required.' }
  // Forms without the Notes field (older clients) leave notes untouched.
  const notesResult = formData.has('notes') ? normalizeProjectNotes(String(formData.get('notes') ?? '')) : null
  if (notesResult && 'error' in notesResult) return { error: notesResult.error }

  const isTM = projectType === 'time_and_materials'
  const billableRateMethod = isTM ? billableRateMethodRaw : null
  const projectHourlyRateCents = isTM && billableRateMethod === 'project' ? centsFrom(formData.get('projectRate')) : null
  const projectFeesCents = projectType === 'fixed_fee' ? centsFrom(formData.get('projectFees')) : null

  let budgetMethod: BudgetMethod = 'none'
  let budgetValue: number | null = null
  if (budgetChoice === 'hours_total') {
    budgetMethod = 'hours_total'
    const hrs = Number(String(formData.get('budgetHours') ?? ''))
    budgetValue = Number.isFinite(hrs) && hrs > 0 ? Math.round(hrs * 60) : null
  } else if (budgetChoice === 'fee_total') {
    budgetMethod = 'fee_total'
    budgetValue = centsFrom(formData.get('budgetFee'))
  }
  const budgetResetsMonthly = formData.get('budgetResetsMonthly') === 'on'
  const alertRaw = Number(String(formData.get('budgetAlertPercent') ?? ''))
  const budgetAlertPercent = Number.isFinite(alertRaw) && alertRaw > 0 ? Math.round(alertRaw) : null

  try {
    await prisma.project.update({
      where: { id },
      data: {
        name,
        code,
        projectType,
        billableRateMethod,
        projectHourlyRateCents,
        projectFeesCents,
        budgetMethod,
        budgetValue,
        budgetResetsMonthly,
        budgetAlertPercent,
        isBillable: projectType !== 'non_billable',
        entityId,
        ...(notesResult ? { notes: notesResult.notes } : {}),
      },
    })
  } catch {
    return { error: 'Could not save the project.' }
  }

  revalidatePath('/projects')
  revalidatePath(`/projects/${id}`)
  return { ok: true }
}

// ── Project team assignments (assign people so they can track time) ──────────

/** Team edits are made on the Edit page and shown on the detail page's Team tab. */
function revalidateProjectTeam(projectId: string) {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/edit`)
}

/**
 * The actor, if they may manage this project's setup: they need manage_projects (plus `extra`, e.g.
 * set_rates) and, for Project Managers, an active PM assignment on this very project — a PM can't
 * reach (or make themselves PM on) projects they don't manage.
 */
async function requireProjectManager(projectId: string, extra?: Capability) {
  const actor = await requireUser()
  const a = { permissionProfile: actor.permissionProfile as PermissionProfile, permissionOverrides: actor.permissionOverrides }
  if (!can(a, 'manage_projects')) return null
  if (extra && !can(a, extra)) return null
  const project = await prisma.project.findFirst({ where: { id: projectId, accountId: actor.accountId }, select: { id: true } })
  if (!project) return null
  if (projectManagementScoped(a) && !(await managesProject(actor.accountId, actor.userId, projectId))) return null
  return actor
}

async function managesProject(accountId: string, userId: string, projectId: string): Promise<boolean> {
  const n = await prisma.projectUserAssignment.count({
    where: { accountId, projectId, userId, isProjectManager: true, isActive: true },
  })
  return n > 0
}

export async function assignUserToProjectAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get('projectId') ?? '')
  const userId = String(formData.get('userId') ?? '')
  const isProjectManager = formData.get('isProjectManager') === 'on'
  const actor = await requireProjectManager(projectId)
  if (!actor || !userId) return
  // The person must belong to the same account (tenant guard).
  const user = await prisma.user.findFirst({ where: { id: userId, accountId: actor.accountId }, select: { id: true } })
  if (!user) return
  await prisma.projectUserAssignment.upsert({
    where: { projectId_userId: { projectId, userId } },
    update: { isActive: true, isProjectManager },
    create: { accountId: actor.accountId, projectId, userId, isProjectManager, isActive: true },
  })
  revalidateProjectTeam(projectId)
}

export async function toggleProjectManagerAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get('projectId') ?? '')
  const userId = String(formData.get('userId') ?? '')
  const actor = await requireProjectManager(projectId)
  if (!actor) return
  const a = await prisma.projectUserAssignment.findFirst({
    where: { projectId, userId, accountId: actor.accountId },
    select: { id: true, isProjectManager: true },
  })
  if (!a) return
  await prisma.projectUserAssignment.update({ where: { id: a.id }, data: { isProjectManager: !a.isProjectManager } })
  revalidateProjectTeam(projectId)
}

export async function unassignUserFromProjectAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get('projectId') ?? '')
  const userId = String(formData.get('userId') ?? '')
  const actor = await requireProjectManager(projectId)
  if (!actor) return
  // Remove the assignment; if the person has tracked time, deactivate instead of hard-delete.
  const scope = { projectId, userId, accountId: actor.accountId }
  const hasTime = await prisma.timeEntry.findFirst({ where: scope, select: { id: true } })
  if (hasTime) {
    await prisma.projectUserAssignment.updateMany({ where: scope, data: { isActive: false } })
  } else {
    await prisma.projectUserAssignment.deleteMany({ where: scope })
  }
  revalidateProjectTeam(projectId)
}

/** Archive or restore a project (specs/03 — archive, never hard-delete in-use records). */
export async function setProjectArchivedAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get('projectId') ?? '')
  const archived = String(formData.get('archived') ?? '') === 'on'
  const actor = await requireProjectManager(projectId)
  if (!actor) return
  await prisma.project.update({ where: { id: projectId }, data: { isActive: !archived, archivedAt: archived ? new Date() : null } })
  revalidatePath('/projects')
  revalidatePath(`/projects/${projectId}`)
}

// ── Per-project rate overrides + task assignments (specs/03, AC-PROJ-002/003) ──

/** Set (or clear) a person's per-project hourly rate override. */
export async function setProjectUserRateAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get('projectId') ?? '')
  const userId = String(formData.get('userId') ?? '')
  // Rates are a money decision (specs/03): need set_rates on top of managing the project.
  const actor = await requireProjectManager(projectId, 'set_rates')
  if (!actor) return
  await prisma.projectUserAssignment.updateMany({
    where: { projectId, userId, accountId: actor.accountId },
    data: { hourlyRateCents: centsFrom(formData.get('rate')) },
  })
  revalidateProjectTeam(projectId)
}

export async function addTaskToProjectAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get('projectId') ?? '')
  const taskId = String(formData.get('taskId') ?? '')
  const actor = await requireProjectManager(projectId)
  if (!actor || !taskId) return
  const task = await prisma.task.findFirst({ where: { id: taskId, accountId: actor.accountId }, select: { id: true, defaultBillable: true } })
  if (!task) return
  await prisma.projectTaskAssignment.upsert({
    where: { projectId_taskId: { projectId, taskId } },
    update: { isActive: true },
    create: { accountId: actor.accountId, projectId, taskId, billable: task.defaultBillable, isActive: true },
  })
  revalidatePath(`/projects/${projectId}`)
}

export async function removeTaskFromProjectAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get('projectId') ?? '')
  const taskId = String(formData.get('taskId') ?? '')
  const actor = await requireProjectManager(projectId)
  if (!actor) return
  await prisma.projectTaskAssignment.deleteMany({ where: { projectId, taskId, accountId: actor.accountId } })
  revalidatePath(`/projects/${projectId}`)
}

export async function toggleProjectTaskBillableAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get('projectId') ?? '')
  const taskId = String(formData.get('taskId') ?? '')
  const actor = await requireProjectManager(projectId)
  if (!actor) return
  const a = await prisma.projectTaskAssignment.findUnique({ where: { projectId_taskId: { projectId, taskId } }, select: { billable: true } })
  if (!a) return
  await prisma.projectTaskAssignment.update({ where: { projectId_taskId: { projectId, taskId } }, data: { billable: !a.billable } })
  revalidatePath(`/projects/${projectId}`)
}

export async function setProjectTaskRateAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get('projectId') ?? '')
  const taskId = String(formData.get('taskId') ?? '')
  const actor = await requireProjectManager(projectId, 'set_rates')
  if (!actor) return
  await prisma.projectTaskAssignment.updateMany({
    where: { projectId, taskId, accountId: actor.accountId },
    data: { hourlyRateCents: centsFrom(formData.get('rate')) },
  })
  revalidatePath(`/projects/${projectId}`)
}
