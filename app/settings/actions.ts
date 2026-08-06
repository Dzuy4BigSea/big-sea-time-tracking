'use server'

import { revalidatePath } from 'next/cache'
import type {
  WeekStart,
  TimeRounding,
  TimeEntryNotesPolicy,
  TimeFormatClock,
  TimeDisplay,
  TimerMode,
  ExpenseReimbursement,
} from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'

export type SettingsState = { error?: string; ok?: boolean }

async function requireSettingsAdmin() {
  const actor = await requireUser()
  if (!can({ permissionProfile: actor.permissionProfile as PermissionProfile }, 'edit_account_settings')) {
    return null
  }
  return actor
}

// Validate a value against a known enum's members; fall back to the current default.
function pick<T extends string>(raw: FormDataEntryValue | null, allowed: readonly T[], fallback: T): T {
  const v = String(raw ?? '') as T
  return allowed.includes(v) ? v : fallback
}

const WEEK: WeekStart[] = ['sunday', 'monday']
const ROUNDING: TimeRounding[] = ['none', 'nearest_1', 'nearest_5', 'nearest_6', 'nearest_10', 'nearest_15']
const NOTES: TimeEntryNotesPolicy[] = ['optional', 'required']
const CLOCK: TimeFormatClock[] = ['h12', 'h24']
const DISPLAY: TimeDisplay[] = ['hh_mm', 'decimal']
const TIMER: TimerMode[] = ['duration', 'start_stop']
const REIMB: ExpenseReimbursement[] = ['disabled', 'allowed']

export async function updatePreferencesAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const actor = await requireSettingsAdmin()
  if (!actor) return { error: 'You do not have permission to change account settings.' }

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: 'Company name is required.' }

  const capRaw = Number(String(formData.get('defaultCapacityHours') ?? '').replace(/[^\d.]/g, ''))
  const defaultCapacityHours = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : 40
  const fyRaw = Number(String(formData.get('fiscalYearStartMonth') ?? '1'))
  const fiscalYearStartMonth = Number.isInteger(fyRaw) && fyRaw >= 1 && fyRaw <= 12 ? fyRaw : 1

  try {
    await prisma.account.update({
      where: { id: actor.accountId },
      data: {
        name,
        timezone: String(formData.get('timezone') ?? '').trim() || 'America/New_York',
        baseCurrency: (String(formData.get('baseCurrency') ?? 'USD').trim() || 'USD').toUpperCase().slice(0, 3),
        dateFormat: String(formData.get('dateFormat') ?? 'MM/DD/YYYY').trim() || 'MM/DD/YYYY',
        fiscalYearStartMonth,
        defaultCapacityHours,
        weekStartsOn: pick(formData.get('weekStartsOn'), WEEK, 'monday'),
        timeRounding: pick(formData.get('timeRounding'), ROUNDING, 'none'),
        timeEntryNotes: pick(formData.get('timeEntryNotes'), NOTES, 'optional'),
        timeFormatClock: pick(formData.get('timeFormatClock'), CLOCK, 'h12'),
        timeDisplay: pick(formData.get('timeDisplay'), DISPLAY, 'hh_mm'),
        timerMode: pick(formData.get('timerMode'), TIMER, 'duration'),
        expenseReimbursement: pick(formData.get('expenseReimbursement'), REIMB, 'disabled'),
      },
    })
  } catch {
    return { error: 'Could not save preferences.' }
  }

  revalidatePath('/settings')
  return { ok: true }
}

const MODULE_KEYS = [
  'timeTracking',
  'expenseTracking',
  'timesheetApproval',
  'team',
  'invoices',
  'estimates',
  'clientDashboard',
  'activityLog',
] as const

export async function updateModulesAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const actor = await requireSettingsAdmin()
  if (!actor) return { error: 'You do not have permission to change modules.' }

  const data = Object.fromEntries(MODULE_KEYS.map((k) => [k, formData.get(k) === 'on'])) as Record<
    (typeof MODULE_KEYS)[number],
    boolean
  >

  try {
    await prisma.module.upsert({
      where: { accountId: actor.accountId },
      update: data,
      create: { accountId: actor.accountId, ...data },
    })
  } catch {
    return { error: 'Could not save modules.' }
  }

  revalidatePath('/', 'layout') // nav visibility depends on modules
  revalidatePath('/settings')
  return { ok: true }
}

export async function createCategoryAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const actor = await requireSettingsAdmin()
  if (!actor) return { error: 'You do not have permission to add categories.' }

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: 'Category name is required.' }
  const unitName = String(formData.get('unitName') ?? '').trim() || null
  const upRaw = Number(String(formData.get('unitPrice') ?? '').replace(/[$,\s]/g, ''))
  const unitPriceCents = Number.isFinite(upRaw) && upRaw > 0 ? Math.round(upRaw * 100) : null

  try {
    await prisma.expenseCategory.create({ data: { accountId: actor.accountId, name, unitName, unitPriceCents } })
  } catch {
    return { error: 'Could not create the category.' }
  }
  revalidatePath('/settings')
  revalidatePath('/expenses')
  return { ok: true }
}

export async function toggleCategoryAction(formData: FormData): Promise<void> {
  const actor = await requireSettingsAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const cat = await prisma.expenseCategory.findFirst({ where: { id, accountId: actor.accountId }, select: { isActive: true } })
  if (!cat) return
  await prisma.expenseCategory.update({ where: { id }, data: { isActive: !cat.isActive } })
  revalidatePath('/settings')
  revalidatePath('/expenses')
}
