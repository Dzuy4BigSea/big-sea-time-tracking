/**
 * Asana import planning (specs/14 §Asana). Pure + DB-free → unit-tested. Decides which
 * Asana projects/people are new vs already imported, matched by gid (projects) or gid/email
 * (people), so re-running import is idempotent (AC-ASANA-002/004).
 */

export interface AsanaProject {
  gid: string
  name: string
}
export interface AsanaUser {
  gid: string
  name: string
  email?: string | null
}

export function planProjectImport(
  existingGids: Set<string>,
  incoming: AsanaProject[],
): { toCreate: AsanaProject[]; toUpdate: AsanaProject[] } {
  const toCreate: AsanaProject[] = []
  const toUpdate: AsanaProject[] = []
  for (const p of incoming) (existingGids.has(p.gid) ? toUpdate : toCreate).push(p)
  return { toCreate, toUpdate }
}

export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length <= 1) return { firstName: full.trim(), lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

export function planUserImport(
  existing: { email: string; asanaUserGid: string | null }[],
  incoming: AsanaUser[],
): { toCreate: AsanaUser[]; toLink: AsanaUser[] } {
  const gids = new Set(existing.map((e) => e.asanaUserGid).filter(Boolean) as string[])
  const emails = new Set(existing.map((e) => e.email.toLowerCase()))
  const toCreate: AsanaUser[] = []
  const toLink: AsanaUser[] = [] // existing account (matched by email) that should get its gid set
  for (const u of incoming) {
    const gidMatch = !!u.gid && gids.has(u.gid)
    const emailMatch = !!u.email && emails.has(u.email.toLowerCase())
    if (gidMatch) continue // already imported
    if (emailMatch) toLink.push(u)
    else toCreate.push(u)
  }
  return { toCreate, toLink }
}
