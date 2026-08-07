'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'

export type NewTaskState = { error?: string; ok?: boolean }
export type EditTaskState = { error?: string; ok?: boolean }

export async function createTaskAction(_prev: NewTaskState, formData: FormData): Promise<NewTaskState> {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_tasks')) {
    return { error: 'You do not have permission to add tasks.' }
  }

  const name = String(formData.get('name') ?? '').trim()
  const defaultBillable = formData.get('defaultBillable') === 'on'
  const autoAddToNewProjects = formData.get('autoAdd') === 'on'
  const rateStr = String(formData.get('rate') ?? '').replace(/[$,\s]/g, '')
  const rate = rateStr ? Number(rateStr) : NaN
  const defaultHourlyRateCents = Number.isFinite(rate) && rate > 0 ? Math.round(rate * 100) : null

  if (!name) return { error: 'Task name is required.' }

  try {
    await prisma.task.create({
      data: { accountId, name, defaultBillable, defaultHourlyRateCents, autoAddToNewProjects },
    })
  } catch {
    return { error: 'Could not create the task.' }
  }

  revalidatePath('/tasks')
  return { ok: true }
}

export async function updateTaskAction(_prev: EditTaskState, formData: FormData): Promise<EditTaskState> {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_tasks')) {
    return { error: 'You do not have permission to edit tasks.' }
  }

  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const defaultBillable = formData.get('defaultBillable') === 'on'
  const autoAddToNewProjects = formData.get('autoAdd') === 'on'
  const rateStr = String(formData.get('rate') ?? '').replace(/[$,\s]/g, '')
  const rate = rateStr ? Number(rateStr) : NaN
  const defaultHourlyRateCents = Number.isFinite(rate) && rate > 0 ? Math.round(rate * 100) : null

  if (!name) return { error: 'Task name is required.' }

  const task = await prisma.task.findFirst({ where: { id, accountId }, select: { id: true } })
  if (!task) return { error: 'Task not found.' }

  try {
    await prisma.task.update({
      where: { id },
      data: { name, defaultBillable, defaultHourlyRateCents, autoAddToNewProjects },
    })
  } catch {
    return { error: 'Could not save the task.' }
  }

  revalidatePath('/tasks')
  return { ok: true }
}
