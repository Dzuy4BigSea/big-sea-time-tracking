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

/** Pull every page of a top-level collection (e.g. resource="clients"). Returns the full array. */
export async function pullAll(token: string, accountId: string, resource: string): Promise<unknown[]> {
  const out: unknown[] = []
  let page = 1
  // Safety cap so a runaway pull can't loop forever.
  for (let i = 0; i < 500; i++) {
    const json = await harvestGet(token, accountId, `/${resource}?per_page=100&page=${page}`)
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

/** Pull the full raw dataset for a backup snapshot. Returns { resource: rows[] } + counts. */
export async function pullBackup(
  token: string,
  accountId: string,
): Promise<{ data: Record<string, unknown[]>; counts: Record<string, number> }> {
  const data: Record<string, unknown[]> = {}
  const counts: Record<string, number> = {}
  for (const resource of BACKUP_RESOURCES) {
    const rows = await pullAll(token, accountId, resource)
    data[resource] = rows
    counts[resource] = rows.length
  }
  return { data, counts }
}
