'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { parseYmd } from '@/lib/week'

export type NewExpenseState = { error?: string; ok?: boolean }
export type NewCategoryState = { error?: string; ok?: boolean }

const centsFrom = (raw: FormDataEntryValue | null): number | null => {
  const n = Number(String(raw ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
}

/** Any authenticated user can record their own expense (Harvest: everyone tracks own expenses). */
export async function createExpenseAction(_prev: NewExpenseState, formData: FormData): Promise<NewExpenseState> {
  const { userId, accountId } = await requireUser()

  const projectId = String(formData.get('projectId') ?? '')
  const categoryId = String(formData.get('categoryId') ?? '')
  const spentDate = parseYmd(String(formData.get('spentDate') ?? ''))
  const totalCents = centsFrom(formData.get('amount'))
  const markupRaw = Number(String(formData.get('markup') ?? '').replace(/[%\s]/g, ''))
  const markupPercent = Number.isFinite(markupRaw) && markupRaw > 0 ? markupRaw : null
  const isBillable = formData.get('isBillable') === 'on'
  const notes = String(formData.get('notes') ?? '').trim() || null

  if (!projectId) return { error: 'Pick a project.' }
  if (!categoryId) return { error: 'Pick a category.' }
  if (!spentDate) return { error: 'Pick a valid date.' }
  if (!totalCents) return { error: 'Enter an amount like 42.50.' }

  // Scope the referenced project + category to this account (tenant isolation, INV-5).
  const [project, category] = await Promise.all([
    prisma.project.findFirst({ where: { id: projectId, accountId }, select: { id: true } }),
    prisma.expenseCategory.findFirst({ where: { id: categoryId, accountId }, select: { id: true } }),
  ])
  if (!project) return { error: 'That project was not found.' }
  if (!category) return { error: 'That category was not found.' }

  try {
    await prisma.expense.create({
      data: {
        accountId,
        userId,
        projectId,
        categoryId,
        spentDate,
        totalCents,
        markupPercent,
        isBillable,
        notes,
      },
    })
  } catch {
    return { error: 'Could not save the expense.' }
  }

  revalidatePath('/expenses')
  return { ok: true }
}

/** Categories are an account setting — only admins/settings-managers create them. */
export async function createCategoryAction(_prev: NewCategoryState, formData: FormData): Promise<NewCategoryState> {
  const { accountId, permissionProfile } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile }, 'edit_account_settings')) {
    return { error: 'You do not have permission to add expense categories.' }
  }

  const name = String(formData.get('name') ?? '').trim()
  const unitName = String(formData.get('unitName') ?? '').trim() || null
  const unitPriceCents = centsFrom(formData.get('unitPrice'))
  if (!name) return { error: 'Category name is required.' }

  try {
    await prisma.expenseCategory.create({
      data: { accountId, name, unitName, unitPriceCents },
    })
  } catch {
    return { error: 'Could not create the category.' }
  }

  revalidatePath('/expenses')
  return { ok: true }
}
