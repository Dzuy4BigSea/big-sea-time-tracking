import 'server-only'

/**
 * Harvest API v2 client (specs/13) — read-only pulls for migration.
 * Auth: Bearer personal access token + Harvest-Account-Id header.
 * Paginated (follows next_page). Used to capture a raw backup snapshot before any ETL.
 */

const HARVEST_API = 'https://api.harvestapp.com/v2'
const PER_PAGE = 2000 // Harvest v2 max — ~20× fewer requests than the default 100

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * GET a Harvest endpoint with rate-limit (429) + transient (5xx) retry & backoff.
 * Harvest allows ~100 requests / 15s; on 429 we honor Retry-After. Retries up to 5×.
 */
async function harvestGet(token: string, accountId: string, path: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${HARVEST_API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Harvest-Account-Id': accountId,
        'User-Agent': 'Track2 Migration (admin)',
        Accept: 'application/json',
      },
    })
    if (res.ok) return res.json()

    if (res.status === 429 || res.status >= 500) {
      if (attempt === 5) throw new Error(`Harvest GET ${path} → ${res.status} after retries`)
      const retryAfter = Number(res.headers.get('retry-after'))
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(15000, 1000 * 2 ** attempt)
      await sleep(waitMs)
      continue
    }
    throw new Error(`Harvest GET ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  throw new Error(`Harvest GET ${path} → exhausted retries`)
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
    const json = await harvestGet(token, accountId, `/${resource}?per_page=${PER_PAGE}&page=${page}${since}`)
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
