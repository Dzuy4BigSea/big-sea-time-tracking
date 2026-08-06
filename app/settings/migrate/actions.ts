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

/**
 * Pull the raw Harvest dataset and store it as an immutable backup snapshot (BEFORE any ETL).
 * `mode=incremental` pulls only records changed since the last successful pull (delta), to cut
 * compute and risk on repeat runs before cutover. Resilient to partial failures (timeout/
 * disconnect): a partial run is recorded and the delta high-water mark only advances on a clean run.
 */
export async function createBackupSnapshotAction(formData: FormData): Promise<void> {
  const actor = await requireMigrateAdmin()
  if (!actor) return
  const conn = await getConnectionWithSecrets(actor.accountId, 'harvest')
  const token = conn?.secrets.accessToken
  const harvestAccountId = String(conn?.config.harvestAccountId ?? '')
  if (!conn || conn.status !== 'connected' || !token || !harvestAccountId) return

  const mode = String(formData.get('mode') ?? 'full') === 'incremental' ? 'incremental' : 'full'
  const lastPulledAt = (conn.config.lastPulledAt as string | undefined) ?? undefined
  const updatedSince = mode === 'incremental' ? lastPulledAt : undefined
  // High-water for the NEXT delta = the moment we START (so records changed during the pull
  // are re-captured next time rather than missed). Slight overlap is safe (idempotent upserts).
  const startedAt = new Date().toISOString()

  let status: 'complete' | 'partial' | 'error' = 'error'
  try {
    const { data, counts, errors } = await pullBackup(token, harvestAccountId, updatedSince)
    const errorKeys = Object.keys(errors)
    const pulledAny = Object.values(counts).some((n) => n > 0) || errorKeys.length === 0
    status = errorKeys.length === 0 ? 'complete' : pulledAny ? 'partial' : 'error'

    await prisma.migrationSnapshot.create({
      data: {
        accountId: actor.accountId,
        source: 'harvest',
        status,
        entityCounts: counts as Prisma.InputJsonValue,
        data: { ...data, _meta: { mode, updatedSince: updatedSince ?? null, startedAt, errors } } as Prisma.InputJsonValue,
        errorMessage: errorKeys.length ? `Failed: ${errorKeys.join(', ')}` : null,
        createdByUserId: actor.userId,
      },
    })

    // Only advance the delta high-water mark on a fully clean run.
    if (status === 'complete') {
      await prisma.integrationConnection.update({
        where: { accountId_provider: { accountId: actor.accountId, provider: 'harvest' } },
        data: { config: { harvestAccountId, lastPulledAt: startedAt } as Prisma.InputJsonValue, lastSyncedAt: new Date() },
      })
    }
  } catch (e) {
    await prisma.migrationSnapshot.create({
      data: {
        accountId: actor.accountId,
        source: 'harvest',
        status: 'error',
        data: { _meta: { mode, updatedSince: updatedSince ?? null, startedAt } } as Prisma.InputJsonValue,
        errorMessage: (e as Error).message?.slice(0, 500),
        createdByUserId: actor.userId,
      },
    })
  }
  revalidatePath('/settings/migrate')
}
