'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { parseYmd } from '@/lib/week'
import { safeHttpUrl } from '@/modules/shared/safeUrl'
import { mayActForOnProject, resolveSubjectUserId } from '@/lib/timesheetSubject'
import { LOGGABLE_PROJECT_WHERE } from '@/modules/time/actingFor'
import { expenseTotalFromInput, parseMoneyCents } from '@/modules/expenses/expenses'

/** Empty → null; otherwise must be an absolute http(s) URL (never javascript:/data:). */
function receiptUrlFrom(formData: FormData): { url: string | null; error?: string } {
  const raw = String(formData.get('receiptFileUrl') ?? '').trim()
  if (!raw) return { url: null }
  const url = safeHttpUrl(raw)
  return url ? { url } : { url: null, error: 'Receipt link must be a full http(s):// URL.' }
}

export type NewExpenseState = { error?: string; ok?: boolean }
export type NewCategoryState = { error?: string; ok?: boolean }

const centsFrom = (raw: FormDataEntryValue | null): number | null => parseMoneyCents(raw)

/**
 * Track an expense (specs/26). For yourself, or for a teammate via `forUserId` when you may act for
 * them on that project (Harvest: Admins, and Managers for their managed people/projects; AC-EXP-113).
 * The project must be one the subject is actively assigned to (AC-EXP-114) and the category active
 * (AC-EXP-117). Unit-priced categories take a quantity (AC-EXP-116).
 */
export async function createExpenseAction(_prev: NewExpenseState, formData: FormData): Promise<NewExpenseState> {
  const current = await requireUser()
  const { accountId } = current

  const projectId = String(formData.get('projectId') ?? '')
  const categoryId = String(formData.get('categoryId') ?? '')
  const spentDate = parseYmd(String(formData.get('spentDate') ?? ''))
  const markupRaw = Number(String(formData.get('markup') ?? '').replace(/[%\s]/g, ''))
  const markupPercent = Number.isFinite(markupRaw) && markupRaw > 0 ? markupRaw : null
  const isBillable = formData.get('isBillable') === 'on'
  const notes = String(formData.get('notes') ?? '').trim() || null
  const receipt = receiptUrlFrom(formData)
  if (receipt.error) return { error: receipt.error }
  const receiptFileUrl = receipt.url

  if (!projectId) return { error: 'Pick a project.' }
  if (!categoryId) return { error: 'Pick a category.' }
  if (!spentDate) return { error: 'Pick a valid date.' }

  const subjectId = await resolveSubjectUserId(current, String(formData.get('forUserId') ?? ''))
  if (!subjectId) return { error: 'You can’t track expenses for that person.' }
  if (subjectId !== current.userId && !(await mayActForOnProject(current, subjectId, projectId))) {
    return { error: 'You can only track expenses for teammates on projects you manage.' }
  }

  // Scope the referenced project + category to this account (INV-5); the project must be one the
  // subject is actively assigned to on an active project/client, the category must be active.
  const [assignment, category] = await Promise.all([
    prisma.projectUserAssignment.findFirst({
      where: { userId: subjectId, projectId, isActive: true, project: { accountId, ...LOGGABLE_PROJECT_WHERE } },
      select: { id: true },
    }),
    prisma.expenseCategory.findFirst({
      where: { id: categoryId, accountId },
      select: { id: true, isActive: true, unitName: true, unitPriceCents: true },
    }),
  ])
  if (!assignment) return { error: 'That project isn’t one you’re assigned to. Ask an Administrator to assign you.' }
  if (!category) return { error: 'That category was not found.' }
  if (!category.isActive) return { error: 'That category is archived. Pick another one.' }

  const total = expenseTotalFromInput(category, { amount: formData.get('amount'), units: formData.get('units') })
  if ('error' in total) return { error: total.error }

  try {
    await prisma.expense.create({
      data: {
        accountId,
        userId: subjectId,
        projectId,
        categoryId,
        spentDate,
        totalCents: total.totalCents,
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

/**
 * Editable by the owner, or by someone who can edit others' time — account-wide for admins/people
 * admins, but a Project Manager only on projects they manage (same scope as the timesheet).
 * Blocked once invoiced (AC-EXP-003).
 */
async function expenseGuard(expenseId: string) {
  const actor = await requireUser()
  const exp = await prisma.expense.findFirst({
    where: { id: expenseId, accountId: actor.accountId },
    select: { userId: true, projectId: true, categoryId: true, lockState: true },
  })
  if (!exp) return null
  if (exp.userId !== actor.userId && !(await mayActForOnProject(actor, exp.userId, exp.projectId))) return null
  if (exp.lockState === 'invoiced') return null // locked once billed
  return { actor, ownerId: exp.userId, categoryId: exp.categoryId }
}

export async function updateExpenseAction(_prev: EditExpenseState, formData: FormData): Promise<EditExpenseState> {
  const id = String(formData.get('id') ?? '')
  const guard = await expenseGuard(id)
  if (!guard) return { error: 'Not found, locked (invoiced), or not permitted.' }
  const { actor } = guard
  const projectId = String(formData.get('projectId') ?? '')
  const categoryId = String(formData.get('categoryId') ?? '')
  const spentDate = parseYmd(String(formData.get('spentDate') ?? ''))
  const markupRaw = Number(String(formData.get('markup') ?? '').replace(/[%\s]/g, ''))
  const markupPercent = Number.isFinite(markupRaw) && markupRaw > 0 ? markupRaw : null
  if (!spentDate) return { error: 'Pick a valid date.' }
  const [project, category] = await Promise.all([
    prisma.project.findFirst({ where: { id: projectId, accountId: actor.accountId }, select: { id: true } }),
    prisma.expenseCategory.findFirst({
      where: { id: categoryId, accountId: actor.accountId },
      select: { id: true, isActive: true, unitName: true, unitPriceCents: true },
    }),
  ])
  if (!project || !category) return { error: 'Project or category not found.' }
  // Harvest: an existing expense stays editable on its (since archived) category, but can't move onto one.
  if (!category.isActive && category.id !== guard.categoryId) return { error: 'That category is archived. Pick another one.' }
  // Re-saving re-prices a unit-based expense at the category's current unit price (Harvest behaviour).
  const total = expenseTotalFromInput(category, { amount: formData.get('amount'), units: formData.get('units') })
  if ('error' in total) return { error: total.error }
  const totalCents = total.totalCents
  // Moving someone else's expense: the actor must also be allowed on the destination project.
  if (guard.ownerId !== actor.userId && !(await mayActForOnProject(actor, guard.ownerId, projectId))) {
    return { error: 'You can only edit expenses on projects you manage.' }
  }
  const receipt = receiptUrlFrom(formData)
  if (receipt.error) return { error: receipt.error }
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
      receiptFileUrl: receipt.url,
    },
  })
  revalidatePath('/expenses')
  return { ok: true }
}

export async function deleteExpenseAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const guard = await expenseGuard(id)
  if (!guard) return
  await prisma.expense.deleteMany({ where: { id, accountId: guard.actor.accountId } })
  revalidatePath('/expenses')
  // From the edit page, go back to the list (only ever to an /expenses URL, never an arbitrary one).
  const back = String(formData.get('redirectTo') ?? '')
  if (/^\/expenses(\?[\w=&.-]*)?$/.test(back)) redirect(back)
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
