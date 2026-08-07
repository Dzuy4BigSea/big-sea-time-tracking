'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ProjectType, BillableRateMethod, BudgetMethod } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { validEntityId } from '@/lib/entities'

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
  } catch {
    return { error: 'Could not create the project.' }
  }

  revalidatePath('/projects')
  redirect(`/projects/${projectId}`) // NEXT_REDIRECT — outside try/catch
}

export async function updateProjectAction(_prev: EditProjectState, formData: FormData): Promise<EditProjectState> {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_projects')) {
    return { error: 'You do not have permission to edit projects.' }
  }

  const id = String(formData.get('id') ?? '')
  const project = await prisma.project.findFirst({ where: { id, accountId }, select: { id: true } })
  if (!project) return { error: 'Project not found.' }
  const entityId = await validEntityId(accountId, String(formData.get('entityId') ?? ''))

  const name = String(formData.get('name') ?? '').trim()
  const code = String(formData.get('code') ?? '').trim() || null
  const projectType = String(formData.get('projectType') ?? 'time_and_materials') as ProjectType
  const billableRateMethodRaw = String(formData.get('billableRateMethod') ?? 'none') as BillableRateMethod
  const budgetChoice = String(formData.get('budgetMethod') ?? 'none')

  if (!name) return { error: 'Project name is required.' }

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

async function requireProjectManager(projectId: string) {
  const actor = await requireUser()
  if (!can({ permissionProfile: actor.permissionProfile as PermissionProfile, permissionOverrides: actor.permissionOverrides }, 'manage_projects')) return null
  const project = await prisma.project.findFirst({ where: { id: projectId, accountId: actor.accountId }, select: { id: true } })
  return project ? actor : null
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
  revalidatePath(`/projects/${projectId}`)
}

export async function toggleProjectManagerAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get('projectId') ?? '')
  const userId = String(formData.get('userId') ?? '')
  const actor = await requireProjectManager(projectId)
  if (!actor) return
  const a = await prisma.projectUserAssignment.findUnique({ where: { projectId_userId: { projectId, userId } }, select: { isProjectManager: true } })
  if (!a) return
  await prisma.projectUserAssignment.update({ where: { projectId_userId: { projectId, userId } }, data: { isProjectManager: !a.isProjectManager } })
  revalidatePath(`/projects/${projectId}`)
}

export async function unassignUserFromProjectAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get('projectId') ?? '')
  const userId = String(formData.get('userId') ?? '')
  const actor = await requireProjectManager(projectId)
  if (!actor) return
  // Remove the assignment; if the person has tracked time, deactivate instead of hard-delete.
  const hasTime = await prisma.timeEntry.findFirst({ where: { projectId, userId }, select: { id: true } })
  if (hasTime) {
    await prisma.projectUserAssignment.updateMany({ where: { projectId, userId }, data: { isActive: false } })
  } else {
    await prisma.projectUserAssignment.deleteMany({ where: { projectId, userId } })
  }
  revalidatePath(`/projects/${projectId}`)
}
