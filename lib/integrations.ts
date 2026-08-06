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

/** Server-only: the connection row + decrypted secrets, for sync flows. Null if not connected. */
export async function getConnectionWithSecrets(
  accountId: string,
  provider: ProviderKey,
): Promise<{
  status: string
  externalOrgId: string | null
  config: Record<string, unknown>
  secrets: Record<string, string>
} | null> {
  const r = await prisma.integrationConnection.findUnique({
    where: { accountId_provider: { accountId, provider: provider as IntegrationProvider } },
  })
  if (!r) return null
  const encMap = (r.secretsEnc as Record<string, string> | null) ?? {}
  const secrets: Record<string, string> = {}
  for (const [k, v] of Object.entries(encMap)) {
    try {
      secrets[k] = decryptSecret(v)
    } catch {
      // Skip undecryptable values (e.g. key rotated) rather than throwing.
    }
  }
  return {
    status: r.status,
    externalOrgId: r.externalOrgId,
    config: (r.config as Record<string, unknown> | null) ?? {},
    secrets,
  }
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
