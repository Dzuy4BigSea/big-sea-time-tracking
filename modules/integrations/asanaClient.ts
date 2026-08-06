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
