'use server'

import { revalidatePath } from 'next/cache'
import { Prisma, type IntegrationProvider } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { encryptSecret, isEncryptionConfigured } from '@/lib/crypto'
import { providerDef, type ProviderKey } from '@/lib/integration-registry'

export type IntegrationState = { error?: string; ok?: boolean }

async function requireIntegrationsAdmin() {
  const actor = await requireUser()
  if (!can({ permissionProfile: actor.permissionProfile as PermissionProfile }, 'edit_account_settings')) return null
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

  const existing = await prisma.integrationConnection.findUnique({
    where: { accountId_provider: { accountId: actor.accountId, provider: provider as IntegrationProvider } },
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
  await prisma.integrationConnection.upsert({
    where: { accountId_provider: { accountId: actor.accountId, provider: provider as IntegrationProvider } },
    update: { secretsEnc: secretsJson, config: configJson, status, externalOrgName, connectedByUserId: actor.userId },
    create: {
      accountId: actor.accountId,
      provider: provider as IntegrationProvider,
      secretsEnc: secretsJson,
      config: configJson,
      status,
      externalOrgName,
      connectedByUserId: actor.userId,
    },
  })

  revalidatePath('/settings/integrations')
  return { ok: true }
}

export async function disconnectIntegrationAction(formData: FormData): Promise<void> {
  const actor = await requireIntegrationsAdmin()
  if (!actor) return
  const provider = String(formData.get('provider') ?? '') as ProviderKey
  if (!providerDef(provider)) return
  await prisma.integrationConnection
    .delete({ where: { accountId_provider: { accountId: actor.accountId, provider: provider as IntegrationProvider } } })
    .catch(() => {})
  revalidatePath('/settings/integrations')
}
