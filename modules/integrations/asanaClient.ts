import 'server-only'
import type { AsanaProject, AsanaUser } from '@/modules/integrations/asanaImport'

const ASANA_API = 'https://app.asana.com/api/1.0'

async function asanaGet(token: string, path: string): Promise<{ data: unknown[] }> {
  const res = await fetch(`${ASANA_API}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Asana GET ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

export async function listAsanaProjects(token: string, workspaceGid: string): Promise<AsanaProject[]> {
  const json = await asanaGet(token, `/projects?workspace=${encodeURIComponent(workspaceGid)}&opt_fields=name&limit=100`)
  return (json.data as { gid: string; name: string }[]).map((p) => ({ gid: p.gid, name: p.name }))
}

export async function listAsanaUsers(token: string, workspaceGid: string): Promise<AsanaUser[]> {
  const json = await asanaGet(token, `/users?workspace=${encodeURIComponent(workspaceGid)}&opt_fields=name,email&limit=100`)
  return (json.data as { gid: string; name: string; email?: string }[]).map((u) => ({ gid: u.gid, name: u.name, email: u.email ?? null }))
}

/** One Asana object by gid, or null on any failure (the app endpoints must answer within Asana's 10 s). */
async function asanaGetOne<T>(token: string, path: string, timeoutMs = 3000): Promise<T | null> {
  try {
    const res = await fetch(`${ASANA_API}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    return ((await res.json()) as { data?: T }).data ?? null
  } catch {
    return null
  }
}

export interface AsanaTaskInfo {
  gid: string
  name: string
  projectGids: string[]
  permalink: string | null
}

/** An Asana task's name, projects and link (specs/29: form defaults + the time-entry link). */
export async function getAsanaTask(token: string, taskGid: string): Promise<AsanaTaskInfo | null> {
  const t = await asanaGetOne<{ gid: string; name?: string; permalink_url?: string; projects?: { gid: string }[] }>(
    token,
    `/tasks/${encodeURIComponent(taskGid)}?opt_fields=name,permalink_url,projects`,
  )
  if (!t) return null
  return { gid: String(t.gid), name: t.name ?? '', projectGids: (t.projects ?? []).map((p) => String(p.gid)), permalink: t.permalink_url ?? null }
}

/** An Asana user's email (specs/29: match a Track2 person by email when the gid isn't linked yet). */
export async function getAsanaUserEmail(token: string, userGid: string): Promise<string | null> {
  const u = await asanaGetOne<{ email?: string }>(token, `/users/${encodeURIComponent(userGid)}?opt_fields=email`)
  return u?.email?.trim().toLowerCase() || null
}
