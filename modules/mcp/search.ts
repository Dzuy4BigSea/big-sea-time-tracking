/**
 * Harvest-style search: case-insensitive substring match that ignores punctuation and spacing
 * ("acme-co" finds "Acme Co."). Used on small lookup tables (clients, tasks, users, categories).
 */
export function normalizeForSearch(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '')
}

/** True when `needle` (already user-typed) matches any of the haystack fields. Empty needle matches all. */
export function matchesSearch(needle: string | undefined, ...fields: (string | null | undefined)[]): boolean {
  if (!needle) return true
  const n = normalizeForSearch(needle)
  if (!n) return true
  return fields.some((f) => !!f && normalizeForSearch(f).includes(n))
}

/** Prefix match on any word-start of a person's name or email (Harvest list_users `search`). */
export function matchesPrefix(needle: string | undefined, ...fields: (string | null | undefined)[]): boolean {
  if (!needle) return true
  const n = needle.trim().toLowerCase()
  if (!n) return true
  return fields.some((f) => {
    if (!f) return false
    const s = f.toLowerCase()
    return s.startsWith(n) || s.split(/[\s@._-]+/).some((w) => w.startsWith(n))
  })
}
