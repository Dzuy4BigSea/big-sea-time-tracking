'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { encryptSecret, isEncryptionConfigured } from '@/lib/crypto'
import { getConnectionWithSecrets } from '@/lib/integrations'
import { pullBackup, verifyHarvest } from '@/modules/integrations/harvestClient'

export type MigrateState = { error?: string; ok?: boolean }

async function requireMigrateAdmin() {
  const actor = await requireUser()
  if (!can({ permissionProfile: actor.permissionProfile as PermissionProfile }, 'edit_account_settings')) return null
  return actor
}

/** Store the Harvest personal access token (encrypted) + account id, and verify it. */
export async function saveHarvestCredsAction(_prev: MigrateState, formData: FormData): Promise<MigrateState> {
  const actor = await requireMigrateAdmin()
  if (!actor) return { error: 'You do not have permission to configure migration.' }
  if (!isEncryptionConfigured()) return { error: 'Set INTEGRATION_ENC_KEY before storing the Harvest token.' }

  const token = String(formData.get('accessToken') ?? '').trim()
  const harvestAccountId = String(formData.get('harvestAccountId') ?? '').trim()
  if (!harvestAccountId) return { error: 'Enter your Harvest Account ID.' }

  // Keep the existing token if the field was left blank.
  const existing = await getConnectionWithSecrets(actor.accountId, 'harvest')
  const effectiveToken = token || existing?.secrets.accessToken
  if (!effectiveToken) return { error: 'Enter your Harvest personal access token.' }

  const check = await verifyHarvest(effectiveToken, harvestAccountId)
  if (!check.ok) return { error: `Could not verify with Harvest: ${check.message ?? 'check the token and account id'}` }

  const secretsEnc: Record<string, string> = { ...(existing ? {} : {}) }
  if (token) secretsEnc.accessToken = encryptSecret(token)
  else if (existing?.secrets.accessToken) secretsEnc.accessToken = encryptSecret(existing.secrets.accessToken)

  await prisma.integrationConnection.upsert({
    where: { accountId_provider: { accountId: actor.accountId, provider: 'harvest' } },
    update: {
      secretsEnc: secretsEnc as Prisma.InputJsonValue,
      config: { harvestAccountId } as Prisma.InputJsonValue,
      status: 'connected',
      externalOrgName: check.name ?? null,
      connectedByUserId: actor.userId,
    },
    create: {
      accountId: actor.accountId,
      provider: 'harvest',
      secretsEnc: secretsEnc as Prisma.InputJsonValue,
      config: { harvestAccountId } as Prisma.InputJsonValue,
      status: 'connected',
      externalOrgName: check.name ?? null,
      connectedByUserId: actor.userId,
    },
  })
  revalidatePath('/settings/migrate')
  return { ok: true }
}

/** Pull the full raw Harvest dataset and store it as an immutable backup snapshot (BEFORE any ETL). */
export async function createBackupSnapshotAction(): Promise<void> {
  const actor = await requireMigrateAdmin()
  if (!actor) return
  const conn = await getConnectionWithSecrets(actor.accountId, 'harvest')
  const token = conn?.secrets.accessToken
  const harvestAccountId = String(conn?.config.harvestAccountId ?? '')
  if (!conn || conn.status !== 'connected' || !token || !harvestAccountId) return

  try {
    const { data, counts } = await pullBackup(token, harvestAccountId)
    await prisma.migrationSnapshot.create({
      data: {
        accountId: actor.accountId,
        source: 'harvest',
        status: 'complete',
        entityCounts: counts as Prisma.InputJsonValue,
        data: data as Prisma.InputJsonValue,
        createdByUserId: actor.userId,
      },
    })
  } catch (e) {
    await prisma.migrationSnapshot.create({
      data: {
        accountId: actor.accountId,
        source: 'harvest',
        status: 'error',
        data: {} as Prisma.InputJsonValue,
        errorMessage: (e as Error).message?.slice(0, 500),
        createdByUserId: actor.userId,
      },
    })
  }
  revalidatePath('/settings/migrate')
}
