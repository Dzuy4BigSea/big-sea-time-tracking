/**
 * Basic info fields Harvest has on a person profile beyond name/type/capacity (specs/28 AC-TEAM-021):
 * Employee ID, Roles (descriptive tags used by the Team "Everyone" filter) and Timezone.
 */

const MAX_ROLES = 20
const MAX_ROLE_LEN = 50

/** "Design, dev ,Design" → ["Design", "dev"]: trimmed, de-duplicated case-insensitively, first spelling kept. */
export function parseRoleTags(raw: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const part of raw.split(',')) {
    const tag = part.trim().replace(/\s+/g, ' ').slice(0, MAX_ROLE_LEN)
    const key = tag.toLocaleLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length >= MAX_ROLES) break
  }
  return out
}

/** A trimmed employee ID, or null when blank. */
export function parseEmployeeId(raw: string): string | null {
  const v = raw.trim().slice(0, 50)
  return v || null
}

/** An IANA timezone the runtime knows, or null (blank / unknown = use the account's timezone). */
export function parseTimezone(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v })
    return v
  } catch {
    return null
  }
}

/** IANA zones for the picker, falling back to a short list on runtimes without supportedValuesOf. */
export function timezoneOptions(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
  const list = intl.supportedValuesOf?.('timeZone')
  return list && list.length > 0
    ? list
    : ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'Europe/London', 'UTC']
}
