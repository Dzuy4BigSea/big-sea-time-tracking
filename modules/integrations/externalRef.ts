/**
 * External work-item links on time entries (specs/29). Pure + DB-free → unit-tested.
 *
 * Harvest stores an `external_reference` on each time entry tracked from another tool:
 *   { id, group_id, account_id, permalink, service, service_icon_url }
 * For Asana, id = task gid, group_id = project gid, service = "app.asana.com". Track2 keeps the same
 * shape on TimeEntry (externalService / externalId / externalGroupId / externalPermalink) with the
 * service normalized, so migrated links and links made from the Track2 Asana app look alike.
 */

export interface ExternalRef {
  externalService: string
  externalId: string
  externalGroupId: string | null
  externalPermalink: string | null
}

export const ASANA = 'asana'

/** "app.asana.com", "asana", "https://app.asana.com" → "asana"; other services kept lower-cased. */
export function normalizeService(service: string | null | undefined): string | null {
  const s = String(service ?? '').trim().toLowerCase()
  if (!s) return null
  if (s === ASANA || /(^|[./])asana\.com(\/|$)/.test(s)) return ASANA
  return s.slice(0, 64)
}

const gidOrNull = (v: unknown): string | null => {
  const s = v == null ? '' : String(v).trim()
  return s ? s.slice(0, 64) : null
}

/** Only http(s) links are stored, so a permalink can be rendered as a link without escaping risk. */
export function safePermalink(v: unknown): string | null {
  const s = v == null ? '' : String(v).trim()
  if (!s || s.length > 500) return null
  try {
    const u = new URL(s)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

/** Map a Harvest time entry's external_reference to Track2 fields; null when absent or unusable. */
export function fromHarvestReference(ref: unknown): ExternalRef | null {
  if (!ref || typeof ref !== 'object') return null
  const r = ref as Record<string, unknown>
  const externalId = gidOrNull(r.id)
  const externalService = normalizeService(r.service as string | undefined) ?? (safePermalink(r.permalink)?.includes('asana.com') ? ASANA : null)
  if (!externalId || !externalService) return null
  return {
    externalService,
    externalId,
    externalGroupId: gidOrNull(r.group_id),
    externalPermalink: safePermalink(r.permalink),
  }
}

/** The Asana task URL for a task gid (project gid optional; Asana redirects either form). */
export function asanaTaskUrl(taskGid: string, projectGid?: string | null): string {
  return `https://app.asana.com/0/${projectGid || '0'}/${taskGid}`
}

