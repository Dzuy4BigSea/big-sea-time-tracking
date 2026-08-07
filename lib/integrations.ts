import 'server-only'
import type { IntegrationProvider } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { decryptSecret } from '@/lib/crypto'
import { PROVIDERS, providerDef, type ProviderKey } from '@/lib/integration-registry'

/** Public (safe) view of a connection for the settings UI — never includes secret values. */
export interface ConnectionView {
  provider: ProviderKey
  status: string
  connected: boolean
  externalOrgName: string | null
  lastSyncedAt: Date | null
  config: Record<string, unknown>
  /** Which secret keys already have a stored value (so the UI can show "set"). */
  secretsSet: string[]
}

export interface DetailedConnectionView extends ConnectionView {
  entityId: string | null
}

/** Every stored connection row as a safe view (incl. entityId) — for the per-entity settings UI. */
export async function getConnectionViewsDetailed(accountId: string): Promise<DetailedConnectionView[]> {
  const rows = await prisma.integrationConnection.findMany({ where: { accountId } })
  return rows.map((r) => {
    const secrets = (r.secretsEnc as Record<string, string> | null) ?? {}
    return {
      provider: r.provider as ProviderKey,
      entityId: r.entityId,
      status: r.status,
      connected: r.status === 'connected',
      externalOrgName: r.externalOrgName ?? null,
      lastSyncedAt: r.lastSyncedAt ?? null,
      config: (r.config as Record<string, unknown> | null) ?? {},
      secretsSet: Object.keys(secrets).filter((k) => !!secrets[k]),
    }
  })
}

export async function getConnectionViews(accountId: string): Promise<Record<string, ConnectionView>> {
  const rows = await prisma.integrationConnection.findMany({ where: { accountId } })
  const byProvider = new Map(rows.map((r) => [r.provider as string, r]))
  const out: Record<string, ConnectionView> = {}
  for (const def of PROVIDERS) {
    const r = byProvider.get(def.key)
    const secrets = (r?.secretsEnc as Record<string, string> | null) ?? {}
    out[def.key] = {
      provider: def.key,
      status: r?.status ?? 'disconnected',
      connected: r?.status === 'connected',
      externalOrgName: r?.externalOrgName ?? null,
      lastSyncedAt: r?.lastSyncedAt ?? null,
      config: (r?.config as Record<string, unknown> | null) ?? {},
      secretsSet: Object.keys(secrets).filter((k) => !!secrets[k]),
    }
  }
  return out
}

/**
 * Server-only: the connection row + decrypted secrets, for sync flows. Null if not connected.
 *
 * Entity-aware (specs/16): when `entityId` is given (Stripe/Xero routing), resolve that entity's
 * connection and fall back to the shared account-wide row (`entityId = null`) if the entity has none.
 * When `entityId` is omitted, resolve the shared row (Asana, or the legacy account-wide connection).
 */
export async function getConnectionWithSecrets(
  accountId: string,
  provider: ProviderKey | IntegrationProvider,
  entityId?: string | null,
): Promise<{
  status: string
  externalOrgId: string | null
  externalOrgName: string | null
  config: Record<string, unknown>
  secrets: Record<string, string>
} | null> {
  const p = provider as IntegrationProvider
  // findFirst (not findUnique) so we can target the shared row where entityId IS NULL — Prisma types
  // a nullable member of a compound unique as non-null in findUnique.
  let r = entityId
    ? await prisma.integrationConnection.findFirst({ where: { accountId, provider: p, entityId } })
    : null
  if (!r) r = await prisma.integrationConnection.findFirst({ where: { accountId, provider: p, entityId: null } })
  if (!r) return null
  return {
    status: r.status,
    externalOrgId: r.externalOrgId,
    externalOrgName: r.externalOrgName,
    config: (r.config as Record<string, unknown> | null) ?? {},
    secrets: decryptSecretMap(r.secretsEnc),
  }
}

/** Decrypt a stored secrets map, skipping values that fail (e.g. key rotated). */
function decryptSecretMap(secretsEnc: unknown): Record<string, string> {
  const encMap = (secretsEnc as Record<string, string> | null) ?? {}
  const secrets: Record<string, string> = {}
  for (const [k, v] of Object.entries(encMap)) {
    try {
      secrets[k] = decryptSecret(v)
    } catch {
      /* skip undecryptable */
    }
  }
  return secrets
}

/**
 * All connections for a provider across the account (shared + every entity), with decrypted secrets.
 * Used by the Stripe webhook, which must verify an incoming event against whichever entity's Stripe
 * account signed it (specs/16).
 */
export async function listConnectionsWithSecrets(
  accountId: string,
  provider: ProviderKey | IntegrationProvider,
): Promise<Array<{
  entityId: string | null
  status: string
  externalOrgId: string | null
  config: Record<string, unknown>
  secrets: Record<string, string>
}>> {
  const rows = await prisma.integrationConnection.findMany({ where: { accountId, provider: provider as IntegrationProvider } })
  return rows.map((r) => ({
    entityId: r.entityId,
    status: r.status,
    externalOrgId: r.externalOrgId,
    config: (r.config as Record<string, unknown> | null) ?? {},
    secrets: decryptSecretMap(r.secretsEnc),
  }))
}

export function isProviderConnected(view: ConnectionView | undefined): boolean {
  return !!view?.connected
}

/** Append an entry to the sync audit log (best-effort; never throws into the caller). */
export async function logSync(input: {
  accountId: string
  provider: ProviderKey
  direction: 'inbound' | 'outbound'
  entityType: string
  entityId?: string | null
  externalId?: string | null
  ok: boolean
  message?: string | null
}): Promise<void> {
  try {
    await prisma.integrationSyncLog.create({
      data: {
        accountId: input.accountId,
        provider: input.provider as IntegrationProvider,
        direction: input.direction,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        externalId: input.externalId ?? null,
        ok: input.ok,
        message: input.message ?? null,
      },
    })
  } catch {
    /* logging must never break the flow */
  }
}

export { providerDef }
