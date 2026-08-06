'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { createHash } from 'node:crypto'
import { encryptSecret, isEncryptionConfigured } from '@/lib/crypto'
import { getConnectionWithSecrets } from '@/lib/integrations'
import { pullAll, verifyHarvest, LIGHT_RESOURCES, HEAVY_RESOURCES } from '@/modules/integrations/harvestClient'

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
  const startYear = 2008 // safe lower bound; empty years are one cheap request each
  const endYear = new Date().getUTCFullYear()

  // Parent snapshot first (status "running") so parts can attach and a crash leaves a visible,
  // partially-populated snapshot rather than nothing.
  const snapshot = await prisma.migrationSnapshot.create({
    data: { accountId: actor.accountId, source: 'harvest', status: 'running', mode, createdByUserId: actor.userId },
  })

  const counts: Record<string, number> = {}
  const errors: Record<string, string> = {}

  // Write one bounded, checksummed part, then let the rows go out of scope (memory freed).
  const writePart = async (resource: string, chunk: string | null, rows: unknown[]) => {
    const json = JSON.stringify(rows)
    const checksum = createHash('sha256').update(json).digest('hex')
    await prisma.migrationSnapshotPart.create({
      data: {
        snapshotId: snapshot.id,
        accountId: actor.accountId,
        resource,
        chunk,
        rowCount: rows.length,
        checksum,
        data: rows as Prisma.InputJsonValue,
      },
    })
    counts[resource] = (counts[resource] ?? 0) + rows.length
  }

  // Light resources — one part each.
  for (const resource of LIGHT_RESOURCES) {
    try {
      const rows = await pullAll(token, harvestAccountId, resource, { updatedSince })
      await writePart(resource, null, rows)
    } catch (e) {
      errors[resource] = (e as Error).message?.slice(0, 200) ?? 'pull failed'
    }
  }

  // Heavy resources — year-chunked in a full pull; single delta part when incremental.
  for (const resource of HEAVY_RESOURCES) {
    if (mode === 'incremental') {
      try {
        const rows = await pullAll(token, harvestAccountId, resource, { updatedSince })
        await writePart(resource, null, rows)
      } catch (e) {
        errors[resource] = (e as Error).message?.slice(0, 200) ?? 'pull failed'
      }
      continue
    }
    counts[resource] = counts[resource] ?? 0
    for (let year = startYear; year <= endYear; year++) {
      try {
        const rows = await pullAll(token, harvestAccountId, resource, { from: `${year}-01-01`, to: `${year}-12-31` })
        if (rows.length > 0) await writePart(resource, String(year), rows)
      } catch (e) {
        errors[`${resource}:${year}`] = (e as Error).message?.slice(0, 200) ?? 'pull failed'
      }
    }
  }

  const errorKeys = Object.keys(errors)
  const status = errorKeys.length === 0 ? 'complete' : 'partial'

  await prisma.migrationSnapshot.update({
    where: { id: snapshot.id },
    data: {
      status,
      entityCounts: counts as Prisma.InputJsonValue,
      meta: { mode, updatedSince: updatedSince ?? null, startedAt, errors } as Prisma.InputJsonValue,
      errorMessage: errorKeys.length ? `Failed: ${errorKeys.join(', ')}` : null,
    },
  })

  // Advance the delta high-water mark only on a fully clean run.
  if (status === 'complete') {
    await prisma.integrationConnection.update({
      where: { accountId_provider: { accountId: actor.accountId, provider: 'harvest' } },
      data: { config: { harvestAccountId, lastPulledAt: startedAt } as Prisma.InputJsonValue, lastSyncedAt: new Date() },
    })
  }
  revalidatePath('/settings/migrate')
}
