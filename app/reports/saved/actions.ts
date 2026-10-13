'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { canEdit, canView, cleanParams, isSavedReportKind, savedReportHref } from '@/modules/reports/savedReports'

export type SaveReportState = { error?: string }

const parseParams = (raw: FormDataEntryValue | null): Record<string, string> => {
  try {
    const v = JSON.parse(String(raw ?? '{}'))
    return v && typeof v === 'object' && !Array.isArray(v) ? cleanParams(v) : {}
  } catch {
    return {}
  }
}
const nameOf = (fd: FormData) => String(fd.get('name') ?? '').trim().slice(0, 200)

/** Load a report the current user may edit (creator or administrator), else null. */
async function editable(id: string) {
  const me = await requireUser()
  const r = await prisma.savedReport.findFirst({ where: { id, accountId: me.accountId } })
  return r && canEdit(r, me.userId, me.permissionProfile) ? { r, me } : null
}

/** "Save report" / "Save as new report": create from the current report's kind + params, then open it. */
export async function createSavedReport(_prev: SaveReportState, fd: FormData): Promise<SaveReportState> {
  const { accountId, userId } = await requireUser()
  const kind = fd.get('kind')
  const name = nameOf(fd)
  if (!isSavedReportKind(kind)) return { error: 'Unknown report type.' }
  if (!name) return { error: 'Please name the report.' }
  const r = await prisma.savedReport.create({
    data: { accountId, createdById: userId, name, kind, params: parseParams(fd.get('params')), shared: fd.get('shared') === '1' },
  })
  revalidatePath('/reports/saved')
  redirect(savedReportHref(r))
}

/** Edit: rename and/or change sharing. */
export async function editSavedReport(_prev: SaveReportState, fd: FormData): Promise<SaveReportState> {
  const ok = await editable(String(fd.get('id') ?? ''))
  if (!ok) return { error: 'You can only edit reports you created.' }
  const name = nameOf(fd)
  if (!name) return { error: 'Please name the report.' }
  await prisma.savedReport.update({ where: { id: ok.r.id }, data: { name, shared: fd.get('shared') === '1' } })
  revalidatePath('/reports', 'layout')
  return {}
}

/** "Update existing report": overwrite the stored params with the report as currently shown. */
export async function updateSavedReportParams(fd: FormData) {
  const ok = await editable(String(fd.get('id') ?? ''))
  if (!ok) return
  const r = await prisma.savedReport.update({ where: { id: ok.r.id }, data: { params: parseParams(fd.get('params')) } })
  revalidatePath('/reports', 'layout')
  redirect(savedReportHref(r))
}

export async function duplicateSavedReport(fd: FormData) {
  const me = await requireUser()
  const src = await prisma.savedReport.findFirst({ where: { id: String(fd.get('id') ?? ''), accountId: me.accountId } })
  if (!src || !canView(src, me.userId)) return
  // The copy belongs to whoever duplicated it and starts private.
  await prisma.savedReport.create({
    data: { accountId: me.accountId, createdById: me.userId, name: `${src.name} (copy)`.slice(0, 200), kind: src.kind, params: src.params ?? {}, shared: false },
  })
  revalidatePath('/reports/saved')
}

export async function setSavedReportArchived(fd: FormData) {
  const ok = await editable(String(fd.get('id') ?? ''))
  if (!ok) return
  await prisma.savedReport.update({ where: { id: ok.r.id }, data: { archivedAt: fd.get('archived') === '1' ? new Date() : null } })
  revalidatePath('/reports/saved')
}

export async function deleteSavedReport(fd: FormData) {
  const ok = await editable(String(fd.get('id') ?? ''))
  if (!ok) return
  await prisma.savedReport.delete({ where: { id: ok.r.id } })
  revalidatePath('/reports/saved')
}
