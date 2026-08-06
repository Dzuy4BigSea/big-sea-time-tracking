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

export interface PullOptions {
  updatedSince?: string // ISO 8601 — delta (records changed since)
  from?: string // YYYY-MM-DD — date-range lower bound (heavy resources, year chunking)
  to?: string // YYYY-MM-DD — date-range upper bound
}

/**
 * Pull every page of a top-level collection (e.g. resource="clients") with optional
 * delta (`updatedSince`) and date-range (`from`/`to`) filters.
 */
export async function pullAll(
  token: string,
  accountId: string,
  resource: string,
  opts: PullOptions = {},
): Promise<unknown[]> {
  const out: unknown[] = []
  let page = 1
  const q: string[] = [`per_page=${PER_PAGE}`]
  if (opts.updatedSince) q.push(`updated_since=${encodeURIComponent(opts.updatedSince)}`)
  if (opts.from) q.push(`from=${encodeURIComponent(opts.from)}`)
  if (opts.to) q.push(`to=${encodeURIComponent(opts.to)}`)
  const base = q.join('&')
  // Safety cap so a runaway pull can't loop forever.
  for (let i = 0; i < 1000; i++) {
    const json = await harvestGet(token, accountId, `/${resource}?${base}&page=${page}`)
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

// Light resources — small; pulled whole into a single part.
export const LIGHT_RESOURCES = ['clients', 'contacts', 'projects', 'tasks', 'users', 'roles', 'expense_categories', 'estimates'] as const

// Heavy resources — can span years; pulled year-by-year (date range) in a FULL backup so each
// part stays bounded. In an INCREMENTAL backup they're pulled by updated_since (small delta).
export const HEAVY_RESOURCES = ['time_entries', 'expenses', 'invoices'] as const

export const BACKUP_RESOURCES = [...LIGHT_RESOURCES, ...HEAVY_RESOURCES] as const

export type BackupResource = (typeof BACKUP_RESOURCES)[number]
