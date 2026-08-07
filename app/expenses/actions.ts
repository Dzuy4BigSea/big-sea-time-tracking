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
  const receiptFileUrl = String(formData.get('receiptFileUrl') ?? '').trim() || null

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
        receiptFileUrl,
      },
    })
  } catch {
    return { error: 'Could not save the expense.' }
  }

  revalidatePath('/expenses')
  return { ok: true }
}

export type EditExpenseState = { error?: string; ok?: boolean }

/** Editable by the owner, or anyone who can edit others' time. Blocked once invoiced (AC-EXP-003). */
async function expenseGuard(expenseId: string) {
  const actor = await requireUser()
  const exp = await prisma.expense.findFirst({ where: { id: expenseId, accountId: actor.accountId }, select: { userId: true, lockState: true } })
  if (!exp) return null
  const isOwner = exp.userId === actor.userId
  const canOthers = can({ permissionProfile: actor.permissionProfile as PermissionProfile, permissionOverrides: actor.permissionOverrides }, 'view_edit_others_time')
  if (!isOwner && !canOthers) return null
  if (exp.lockState === 'invoiced') return null // locked once billed
  return actor
}

export async function updateExpenseAction(_prev: EditExpenseState, formData: FormData): Promise<EditExpenseState> {
  const id = String(formData.get('id') ?? '')
  const actor = await expenseGuard(id)
  if (!actor) return { error: 'Not found, locked (invoiced), or not permitted.' }
  const projectId = String(formData.get('projectId') ?? '')
  const categoryId = String(formData.get('categoryId') ?? '')
  const spentDate = parseYmd(String(formData.get('spentDate') ?? ''))
  const totalCents = centsFrom(formData.get('amount'))
  const markupRaw = Number(String(formData.get('markup') ?? '').replace(/[%\s]/g, ''))
  const markupPercent = Number.isFinite(markupRaw) && markupRaw > 0 ? markupRaw : null
  if (!spentDate) return { error: 'Pick a valid date.' }
  if (!totalCents) return { error: 'Enter an amount like 42.50.' }
  const [project, category] = await Promise.all([
    prisma.project.findFirst({ where: { id: projectId, accountId: actor.accountId }, select: { id: true } }),
    prisma.expenseCategory.findFirst({ where: { id: categoryId, accountId: actor.accountId }, select: { id: true } }),
  ])
  if (!project || !category) return { error: 'Project or category not found.' }
  await prisma.expense.update({
    where: { id },
    data: {
      projectId,
      categoryId,
      spentDate,
      totalCents,
      markupPercent,
      isBillable: formData.get('isBillable') === 'on',
      notes: String(formData.get('notes') ?? '').trim() || null,
      receiptFileUrl: String(formData.get('receiptFileUrl') ?? '').trim() || null,
    },
  })
  revalidatePath('/expenses')
  return { ok: true }
}

export async function deleteExpenseAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const actor = await expenseGuard(id)
  if (!actor) return
  await prisma.expense.deleteMany({ where: { id, accountId: actor.accountId } })
  revalidatePath('/expenses')
}

/** Categories are an account setting — only admins/settings-managers create them. */
export async function createCategoryAction(_prev: NewCategoryState, formData: FormData): Promise<NewCategoryState> {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'edit_account_settings')) {
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
