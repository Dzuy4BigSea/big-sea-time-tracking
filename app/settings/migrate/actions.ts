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
import { runImportBatch, type ImportBatchResult, type ImportCursor } from '@/modules/migration/importer'

export type MigrateState = { error?: string; ok?: boolean }

async function requireMigrateAdmin() {
  const actor = await requireUser()
  if (!can({ permissionProfile: actor.permissionProfile as PermissionProfile, permissionOverrides: actor.permissionOverrides }, 'edit_account_settings')) return null
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

  // Harvest is account-wide (shared, entityId null). Manual upsert — a nullable member of a compound
  // unique can't be targeted by upsert/findUnique.
  const existingHarvest = await prisma.integrationConnection.findFirst({
    where: { accountId: actor.accountId, provider: 'harvest', entityId: null },
    select: { id: true },
  })
  const harvestData = {
    secretsEnc: secretsEnc as Prisma.InputJsonValue,
    config: { harvestAccountId } as Prisma.InputJsonValue,
    status: 'connected' as const,
    externalOrgName: check.name ?? null,
    connectedByUserId: actor.userId,
  }
  if (existingHarvest) {
    await prisma.integrationConnection.update({ where: { id: existingHarvest.id }, data: harvestData })
  } else {
    await prisma.integrationConnection.create({ data: { accountId: actor.accountId, provider: 'harvest', entityId: null, ...harvestData } })
  }
  revalidatePath('/settings/migrate')
  return { ok: true }
}

const BACKUP_START_YEAR = 2008
const BATCH_BUDGET_MS = 45_000 // stay well under the serverless execution cap per invocation

interface WorkItem {
  resource: string
  chunk: string | null
  from?: string
  to?: string
  updatedSince?: string
}

/** The full ordered work list for a backup of the given mode. */
function backupWorkList(mode: string, updatedSince?: string): WorkItem[] {
  const items: WorkItem[] = []
  for (const resource of LIGHT_RESOURCES) items.push({ resource, chunk: null, updatedSince })
  const endYear = new Date().getUTCFullYear()
  for (const resource of HEAVY_RESOURCES) {
    if (mode === 'incremental') {
      items.push({ resource, chunk: null, updatedSince })
    } else {
      for (let y = BACKUP_START_YEAR; y <= endYear; y++) {
        items.push({ resource, chunk: String(y), from: `${y}-01-01`, to: `${y}-12-31` })
      }
    }
  }
  return items
}

const workKey = (w: { resource: string; chunk: string | null }) => `${w.resource}|${w.chunk ?? ''}`

export type BackupProgress = {
  ok: boolean
  message?: string
  snapshotId?: string
  mode?: string
  status?: 'running' | 'complete' | 'partial' | 'error'
  /** work items captured so far (parts written) */
  done?: number
  /** total work items in this backup's plan */
  total?: number
  /** work items still to capture */
  remaining?: number
  /** rows captured per resource so far */
  counts?: Record<string, number>
  /** total rows captured so far */
  rows?: number
  /** work keys that hit an error (captured empty so the run can finish) */
  errorKeys?: string[]
}

/**
 * Process ONE resumable batch of a raw backup (BEFORE any ETL) and return structured progress.
 * Each call pulls a time-bounded slice of the work list, skips items already captured for this
 * snapshot, and reports how far along the whole plan is. A multi-year dataset that can't be pulled
 * in one serverless request is captured safely by calling this repeatedly (the client runner drives
 * it automatically; the plain form action below is the no-JS fallback). `mode=incremental` pulls
 * only records changed since the last clean pull (delta).
 */
async function executeBackupBatch(
  actor: { accountId: string; userId: string },
  opts: { resumeId?: string; mode?: string },
): Promise<BackupProgress> {
  const conn = await getConnectionWithSecrets(actor.accountId, 'harvest')
  const token = conn?.secrets.accessToken
  const harvestAccountId = String(conn?.config.harvestAccountId ?? '')
  if (!conn || conn.status !== 'connected' || !token || !harvestAccountId) {
    return { ok: false, message: 'Connect a verified Harvest account first.' }
  }

  // Resume an existing running snapshot, or start a new one.
  let snapshot = opts.resumeId
    ? await prisma.migrationSnapshot.findFirst({ where: { id: opts.resumeId, accountId: actor.accountId, status: 'running' } })
    : null
  if (!snapshot) {
    const mode = opts.mode === 'incremental' ? 'incremental' : 'full'
    const updatedSince = mode === 'incremental' ? ((conn.config.lastPulledAt as string | undefined) ?? undefined) : undefined
    if (mode === 'incremental' && !updatedSince) {
      return { ok: false, message: 'No previous clean pull to delta from — run a full backup first.' }
    }
    snapshot = await prisma.migrationSnapshot.create({
      data: {
        accountId: actor.accountId,
        source: 'harvest',
        status: 'running',
        mode,
        // startedAt captured now = the delta high-water mark to use once this snapshot completes.
        meta: { startedAt: new Date().toISOString(), updatedSince: updatedSince ?? null, errors: {} } as Prisma.InputJsonValue,
        createdByUserId: actor.userId,
      },
    })
  }

  const meta = (snapshot.meta as { startedAt?: string; updatedSince?: string | null; errors?: Record<string, string> } | null) ?? {}
  const updatedSince = meta.updatedSince ?? undefined
  const errors: Record<string, string> = { ...(meta.errors ?? {}) }

  // What's already captured for this snapshot (resume skips these).
  const existing = await prisma.migrationSnapshotPart.findMany({ where: { snapshotId: snapshot.id }, select: { resource: true, chunk: true } })
  const done = new Set(existing.map((p) => workKey(p)))

  const work = backupWorkList(snapshot.mode, updatedSince)
  const start = Date.now()
  let processedThisBatch = 0

  for (const item of work) {
    if (done.has(workKey(item))) continue
    if (Date.now() - start > BATCH_BUDGET_MS && processedThisBatch > 0) break // time budget — resume next call
    try {
      const rows = await pullAll(token, harvestAccountId, item.resource, {
        updatedSince: item.updatedSince,
        from: item.from,
        to: item.to,
      })
      // Always write a part (even empty) so "done" tracking is exact and resume never re-pulls it.
      const json = JSON.stringify(rows)
      const checksum = createHash('sha256').update(json).digest('hex')
      await prisma.migrationSnapshotPart.create({
        data: {
          snapshotId: snapshot.id,
          accountId: actor.accountId,
          resource: item.resource,
          chunk: item.chunk,
          rowCount: rows.length,
          checksum,
          data: rows as Prisma.InputJsonValue,
        },
      })
      done.add(workKey(item))
      delete errors[workKey(item)] // a previously-failed item that now succeeded
    } catch (e) {
      errors[workKey(item)] = (e as Error).message?.slice(0, 200) ?? 'pull failed'
      done.add(workKey(item)) // don't get stuck retrying the same failing item forever
    }
    processedThisBatch++
  }

  const remaining = work.filter((w) => !done.has(workKey(w))).length
  const errorKeys = Object.keys(errors)
  const finished = remaining === 0
  const status: 'running' | 'complete' | 'partial' = !finished ? 'running' : errorKeys.length ? 'partial' : 'complete'

  // Recompute counts from the parts actually stored.
  const grouped = await prisma.migrationSnapshotPart.groupBy({
    by: ['resource'],
    where: { snapshotId: snapshot.id },
    _sum: { rowCount: true },
  })
  const counts: Record<string, number> = {}
  for (const g of grouped) counts[g.resource] = g._sum.rowCount ?? 0
  const rows = Object.values(counts).reduce((a, b) => a + b, 0)

  await prisma.migrationSnapshot.update({
    where: { id: snapshot.id },
    data: {
      status,
      entityCounts: counts as Prisma.InputJsonValue,
      meta: { ...meta, errors, remaining, total: work.length } as Prisma.InputJsonValue,
      errorMessage: errorKeys.length ? `Issues: ${errorKeys.join(', ')}` : null,
    },
  })

  if (finished && status === 'complete' && meta.startedAt) {
    await prisma.integrationConnection.updateMany({
      where: { accountId: actor.accountId, provider: 'harvest', entityId: null },
      data: { config: { harvestAccountId, lastPulledAt: meta.startedAt } as Prisma.InputJsonValue, lastSyncedAt: new Date() },
    })
  }
  revalidatePath('/settings/migrate')
  return {
    ok: true,
    snapshotId: snapshot.id,
    mode: snapshot.mode,
    status,
    done: work.length - remaining,
    total: work.length,
    remaining,
    counts,
    rows,
    errorKeys,
  }
}

/** Plain form action — no-JS fallback that runs a single batch (one "Continue" press). */
export async function createBackupSnapshotAction(formData: FormData): Promise<void> {
  const actor = await requireMigrateAdmin()
  if (!actor) return
  await executeBackupBatch(actor, {
    resumeId: String(formData.get('snapshotId') ?? '') || undefined,
    mode: String(formData.get('mode') ?? 'full'),
  })
}

/** Client-driven batch: runs one batch and returns progress so the runner can auto-continue. */
export async function backupBatchAction(input: { snapshotId?: string; mode?: string }): Promise<BackupProgress> {
  const actor = await requireMigrateAdmin()
  if (!actor) return { ok: false, message: 'You do not have permission to run a migration.' }
  return executeBackupBatch(actor, { resumeId: input.snapshotId, mode: input.mode })
}

/**
 * Client-driven ETL batch (snapshot → Track2). `dryRun:true` previews without writing; `dryRun:false`
 * applies idempotent upserts. Resumable via the returned cursor, driven to completion by ImportRunner.
 */
export async function importBatchAction(input: {
  snapshotId: string
  dryRun: boolean
  cursor?: ImportCursor | null
}): Promise<ImportBatchResult> {
  const actor = await requireMigrateAdmin()
  if (!actor) {
    return {
      ok: false, message: 'You do not have permission to run a migration.',
      dryRun: input.dryRun, done: true, cursor: null, batch: {}, processedThisBatch: 0, totalRows: 0, stageLabel: '', notes: [],
    }
  }
  const res = await runImportBatch(actor.accountId, input.snapshotId, { dryRun: input.dryRun, cursor: input.cursor })
  if (!input.dryRun && res.done) revalidatePath('/settings/migrate')
  return res
}
