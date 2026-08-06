import 'server-only'

/**
 * Harvest API v2 client (specs/13) — read-only pulls for migration.
 * Auth: Bearer personal access token + Harvest-Account-Id header.
 * Paginated (follows next_page). Used to capture a raw backup snapshot before any ETL.
 */

const HARVEST_API = 'https://api.harvestapp.com/v2'

async function harvestGet(
  token: string,
  accountId: string,
  path: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${HARVEST_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Harvest-Account-Id': accountId,
      'User-Agent': 'Track2 Migration (admin)',
      Accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Harvest GET ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

/**
 * Pull every page of a top-level collection (e.g. resource="clients").
 * `updatedSince` (ISO 8601) limits to records changed since then — the delta mechanism.
 */
export async function pullAll(
  token: string,
  accountId: string,
  resource: string,
  updatedSince?: string,
): Promise<unknown[]> {
  const out: unknown[] = []
  let page = 1
  const since = updatedSince ? `&updated_since=${encodeURIComponent(updatedSince)}` : ''
  // Safety cap so a runaway pull can't loop forever.
  for (let i = 0; i < 1000; i++) {
    const json = await harvestGet(token, accountId, `/${resource}?per_page=100&page=${page}${since}`)
    const arr = (json[resource] as unknown[]) ?? []
    out.push(...arr)
    const nextPage = json.next_page as number | null
    if (!nextPage) break
    page = nextPage
  }
  return out
}

/** Verify the token/account by hitting the lightweight company endpoint. */
export async function verifyHarvest(token: string, accountId: string): Promise<{ ok: boolean; name?: string; message?: string }> {
  try {
    const json = await harvestGet(token, accountId, '/company')
    return { ok: true, name: (json.name as string) ?? undefined }
  } catch (e) {
    return { ok: false, message: (e as Error).message?.slice(0, 200) }
  }
}

// The core resources we back up (top-level Harvest v2 collections).
export const BACKUP_RESOURCES = [
  'clients',
  'contacts',
  'projects',
  'tasks',
  'users',
  'roles',
  'time_entries',
  'expenses',
  'expense_categories',
  'invoices',
  'estimates',
] as const

export type BackupResource = (typeof BACKUP_RESOURCES)[number]

/**
 * Pull the raw dataset for a backup snapshot. Resilient: each resource is pulled
 * independently, so one failure (timeout/disconnect) doesn't lose the rest — failures are
 * reported in `errors` and the caller decides whether the run is complete/partial.
 * `updatedSince` makes it a delta pull (only records changed since then).
 */
export async function pullBackup(
  token: string,
  accountId: string,
  updatedSince?: string,
): Promise<{ data: Record<string, unknown[]>; counts: Record<string, number>; errors: Record<string, string> }> {
  const data: Record<string, unknown[]> = {}
  const counts: Record<string, number> = {}
  const errors: Record<string, string> = {}
  for (const resource of BACKUP_RESOURCES) {
    try {
      const rows = await pullAll(token, accountId, resource, updatedSince)
      data[resource] = rows
      counts[resource] = rows.length
    } catch (e) {
      errors[resource] = (e as Error).message?.slice(0, 200) ?? 'pull failed'
      data[resource] = []
      counts[resource] = 0
    }
  }
  return { data, counts, errors }
}
