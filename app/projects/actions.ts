'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ProjectType, BillableRateMethod, BudgetMethod } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'

export type NewProjectState = { error?: string }

const centsFrom = (raw: FormDataEntryValue | null): number | null => {
  const n = Number(String(raw ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
}

export async function createProjectAction(_prev: NewProjectState, formData: FormData): Promise<NewProjectState> {
  const { userId, accountId, permissionProfile } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile }, 'manage_projects')) {
    return { error: 'You do not have permission to add projects.' }
  }

  const clientId = String(formData.get('clientId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const code = String(formData.get('code') ?? '').trim() || null
  const projectType = String(formData.get('projectType') ?? 'time_and_materials') as ProjectType
  const billableRateMethodRaw = String(formData.get('billableRateMethod') ?? 'none') as BillableRateMethod
  const budgetChoice = String(formData.get('budgetMethod') ?? 'none') // none | hours_total | fee_total

  if (!name) return { error: 'Project name is required.' }
  const client = await prisma.client.findFirst({ where: { id: clientId, accountId }, select: { id: true } })
  if (!client) return { error: 'Pick a valid client.' }

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
