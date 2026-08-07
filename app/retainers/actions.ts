'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { planDeposit, planDrawdown } from '@/modules/invoicing/retainer'

export type RetainerState = { error?: string; ok?: boolean }

const centsFrom = (raw: FormDataEntryValue | null): number | null => {
  const n = Number(String(raw ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
}

async function requireInvoiceAdmin() {
  const actor = await requireUser()
  if (!can({ permissionProfile: actor.permissionProfile as PermissionProfile, permissionOverrides: actor.permissionOverrides }, 'manage_invoices')) return null
  return actor
}

async function scopedRetainer(id: string, accountId: string) {
  return prisma.retainer.findFirst({ where: { id, accountId }, select: { id: true, depositCents: true, drawnCents: true } })
}

export async function createRetainerAction(_prev: RetainerState, formData: FormData): Promise<RetainerState> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return { error: 'You do not have permission to manage retainers.' }

  const clientId = String(formData.get('clientId') ?? '')
  const projectRaw = String(formData.get('projectId') ?? '')
  const projectId = projectRaw && projectRaw !== 'all' ? projectRaw : null
  const depositCents = centsFrom(formData.get('deposit')) ?? 0

  const client = await prisma.client.findFirst({ where: { id: clientId, accountId: actor.accountId }, select: { id: true } })
  if (!client) return { error: 'Pick a client.' }
  if (projectId) {
    const proj = await prisma.project.findFirst({ where: { id: projectId, accountId: actor.accountId, clientId }, select: { id: true } })
    if (!proj) return { error: 'That project does not belong to the selected client.' }
  }

  try {
    await prisma.retainer.create({
      data: {
        accountId: actor.accountId,
        clientId,
        projectId,
        depositCents,
        drawnCents: 0,
        balanceCents: depositCents,
        status: 'ongoing',
      },
    })
  } catch {
    return { error: 'Could not create the retainer.' }
  }
  revalidatePath('/retainers')
  return { ok: true }
}

export async function addDepositAction(formData: FormData): Promise<void> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const amountCents = centsFrom(formData.get('amount'))
  if (!amountCents) return
  const r = await scopedRetainer(id, actor.accountId)
  if (!r) return
  const next = planDeposit({ depositCents: r.depositCents, drawnCents: r.drawnCents }, amountCents)
  await prisma.retainer.update({ where: { id }, data: { depositCents: next.depositCents, balanceCents: next.balanceCents } })
  revalidatePath('/retainers')
}

export async function applyDrawdownAction(formData: FormData): Promise<void> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const amountCents = centsFrom(formData.get('amount'))
  if (!amountCents) return
  const r = await scopedRetainer(id, actor.accountId)
  if (!r) return
  try {
    const next = planDrawdown({ depositCents: r.depositCents, drawnCents: r.drawnCents }, amountCents) // default: reject overdraw
    await prisma.retainer.update({ where: { id }, data: { drawnCents: next.drawnCents, balanceCents: next.balanceCents } })
  } catch {
    // overdraw or invalid amount — no-op (default policy rejects; AC-RET-003)
  }
  revalidatePath('/retainers')
}

export async function archiveRetainerAction(formData: FormData): Promise<void> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const r = await prisma.retainer.findFirst({ where: { id, accountId: actor.accountId }, select: { status: true } })
  if (!r) return
  await prisma.retainer.update({ where: { id }, data: { status: r.status === 'ongoing' ? 'archived' : 'ongoing' } })
  revalidatePath('/retainers')
}
