'use server'

import { revalidatePath } from 'next/cache'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Prisma, type IntegrationProvider } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { encryptSecret, isEncryptionConfigured } from '@/lib/crypto'
import { providerDef, type ProviderKey } from '@/lib/integration-registry'
import { getConnectionWithSecrets, logSync } from '@/lib/integrations'
import { listAsanaProjects, listAsanaUsers } from '@/modules/integrations/asanaClient'
import { planProjectImport, planUserImport, splitName } from '@/modules/integrations/asanaImport'

export type IntegrationState = { error?: string; ok?: boolean }

async function requireIntegrationsAdmin() {
  const actor = await requireUser()
  if (!can({ permissionProfile: actor.permissionProfile as PermissionProfile, permissionOverrides: actor.permissionOverrides }, 'edit_account_settings')) return null
  return actor
}

export async function saveIntegrationAction(_prev: IntegrationState, formData: FormData): Promise<IntegrationState> {
  const actor = await requireIntegrationsAdmin()
  if (!actor) return { error: 'You do not have permission to manage integrations.' }

  const provider = String(formData.get('provider') ?? '') as ProviderKey
  const def = providerDef(provider)
  if (!def) return { error: 'Unknown integration.' }

  if (!isEncryptionConfigured()) {
    return { error: 'Set the INTEGRATION_ENC_KEY environment variable before storing integration secrets.' }
  }

  // Business entity (specs/16): Stripe/Xero connect per entity; Asana + others stay shared (null).
  const entityId = provider === 'asana' ? null : String(formData.get('entityId') ?? '').trim() || null
  const existing = await prisma.integrationConnection.findFirst({
    where: { accountId: actor.accountId, provider: provider as IntegrationProvider, entityId },
  })
  const existingSecrets = (existing?.secretsEnc as Record<string, string> | null) ?? {}

  // Secrets: encrypt newly-entered values; keep the stored value when the field is left blank.
  const secretsEnc: Record<string, string> = { ...existingSecrets }
  for (const f of def.secrets) {
    const raw = String(formData.get(`secret_${f.key}`) ?? '').trim()
    if (raw) secretsEnc[f.key] = encryptSecret(raw)
  }

  // Non-secret config.
  const config: Record<string, string | boolean> = {}
  for (const f of def.config) {
    if (f.kind === 'toggle') config[f.key] = formData.get(`config_${f.key}`) === 'on'
    else config[f.key] = String(formData.get(`config_${f.key}`) ?? '').trim()
  }

  const missingSecret = def.secrets.some((f) => f.required && !secretsEnc[f.key])
  const missingConfig = def.config.some((f) => f.required && !String(config[f.key] ?? ''))
  const status = missingSecret || missingConfig ? 'disconnected' : 'connected'

  const externalOrgName = def.orgNameField ? String(config[def.orgNameField] ?? '') || null : null

  const secretsJson = secretsEnc as Prisma.InputJsonValue
  const configJson = config as Prisma.InputJsonValue
  // Manual upsert: a nullable member of a compound unique can't be targeted by upsert/findUnique.
  if (existing) {
    await prisma.integrationConnection.update({
      where: { id: existing.id },
      data: { secretsEnc: secretsJson, config: configJson, status, externalOrgName, connectedByUserId: actor.userId },
    })
  } else {
    await prisma.integrationConnection.create({
      data: {
        accountId: actor.accountId,
        provider: provider as IntegrationProvider,
        entityId,
        secretsEnc: secretsJson,
        config: configJson,
        status,
        externalOrgName,
        connectedByUserId: actor.userId,
      },
    })
  }

  revalidatePath('/settings/integrations')
  return { ok: true }
}

/** Import projects + people from the connected Asana workspace (specs/14, AC-ASANA-001/002/004). */
export async function importAsanaAction(): Promise<void> {
  const actor = await requireIntegrationsAdmin()
  if (!actor) return
  const conn = await getConnectionWithSecrets(actor.accountId, 'asana')
  const token = conn?.secrets.accessToken
  const workspaceGid = String(conn?.config.workspaceGid ?? '')
  if (!conn || conn.status !== 'connected' || !token || !workspaceGid) return

  try {
    // People
    const asanaUsers = await listAsanaUsers(token, workspaceGid)
    const existingUsers = await prisma.user.findMany({ where: { accountId: actor.accountId }, select: { id: true, email: true, asanaUserGid: true } })
    const { toCreate: newUsers, toLink } = planUserImport(existingUsers, asanaUsers)
    for (const u of newUsers) {
      const { firstName, lastName } = splitName(u.name)
      const email = (u.email ?? `${u.gid}@asana.imported`).toLowerCase()
      await prisma.user
        .create({
          data: {
            accountId: actor.accountId,
            email,
            passwordHash: bcrypt.hashSync(randomBytes(24).toString('hex'), 10), // unusable until a reset
            firstName,
            lastName,
            asanaUserGid: u.gid,
            permissionProfile: 'member',
          },
        })
        .catch(() => {})
    }
    for (const u of toLink) {
      const match = existingUsers.find((e) => u.email && e.email.toLowerCase() === u.email.toLowerCase())
      if (match) await prisma.user.update({ where: { id: match.id }, data: { asanaUserGid: u.gid } }).catch(() => {})
    }

    // Projects — need a client to attach to. Use the configured client, else find/create a fallback.
    let clientId = String(conn.config.defaultClientId ?? '')
    const validClient = clientId
      ? await prisma.client.findFirst({ where: { id: clientId, accountId: actor.accountId }, select: { id: true } })
      : null
    if (!validClient) {
      const label = `${String(conn.config.workspaceName ?? 'Asana')} (imported)`
      const fallback =
        (await prisma.client.findFirst({ where: { accountId: actor.accountId, name: label }, select: { id: true } })) ??
        (await prisma.client.create({ data: { accountId: actor.accountId, name: label } }))
      clientId = fallback.id
    }

    const asanaProjects = await listAsanaProjects(token, workspaceGid)
    const existingProjects = await prisma.project.findMany({ where: { accountId: actor.accountId, asanaProjectGid: { not: null } }, select: { asanaProjectGid: true } })
    const existingGids = new Set(existingProjects.map((p) => p.asanaProjectGid as string))
    const { toCreate: newProjects, toUpdate } = planProjectImport(existingGids, asanaProjects)
    for (const p of newProjects) {
      await prisma.project.create({ data: { accountId: actor.accountId, clientId, name: p.name, asanaProjectGid: p.gid } }).catch(() => {})
    }
    for (const p of toUpdate) {
      await prisma.project.updateMany({ where: { accountId: actor.accountId, asanaProjectGid: p.gid }, data: { name: p.name } }).catch(() => {})
    }

    await prisma.integrationConnection.updateMany({
      where: { accountId: actor.accountId, provider: 'asana', entityId: null },
      data: { lastSyncedAt: new Date() },
    })
    await logSync({ accountId: actor.accountId, provider: 'asana', direction: 'inbound', entityType: 'project', ok: true, message: `Imported ${newProjects.length} projects, ${newUsers.length} people` })
  } catch (e) {
    await logSync({ accountId: actor.accountId, provider: 'asana', direction: 'inbound', entityType: 'project', ok: false, message: (e as Error).message?.slice(0, 200) })
  }
  revalidatePath('/settings/integrations')
  revalidatePath('/projects')
  revalidatePath('/team')
}

export async function disconnectIntegrationAction(formData: FormData): Promise<void> {
  const actor = await requireIntegrationsAdmin()
  if (!actor) return
  const provider = String(formData.get('provider') ?? '') as ProviderKey
  if (!providerDef(provider)) return
  const entityId = provider === 'asana' ? null : String(formData.get('entityId') ?? '').trim() || null
  await prisma.integrationConnection
    .deleteMany({ where: { accountId: actor.accountId, provider: provider as IntegrationProvider, entityId } })
    .catch(() => {})
  revalidatePath('/settings/integrations')
}
