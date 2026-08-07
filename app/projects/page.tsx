import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { NewProjectForm } from '@/components/NewProjectForm'
import { EntityChip } from '@/components/EntitySelect'
import { listEntities } from '@/lib/entities'

export const dynamic = 'force-dynamic'

const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  time_and_materials: { label: 'Time & Materials', className: 'bg-blue-100 text-blue-700' },
  fixed_fee: { label: 'Fixed Fee', className: 'bg-purple-100 text-purple-700' },
  non_billable: { label: 'Non-Billable', className: 'bg-gray-100 text-gray-600' },
}

function budgetLabel(method: string, value: number | null): string {
  if (!value) return '—'
  switch (method) {
    case 'hours_total':
    case 'hours_per_task':
    case 'hours_per_person':
      return `${(value / 60).toLocaleString()}h`
    case 'fee_total':
    case 'cost_total':
      return formatCents(value)
    default:
      return '—'
  }
}

const hours = (minutes: number) => (minutes / 60).toLocaleString(undefined, { maximumFractionDigits: 2 })

export default async function ProjectsPage() {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  const canManage = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_projects')
  const [projects, clients, entities] = await Promise.all([
    prisma.project.findMany({
      where: { accountId },
      include: {
        client: true,
        entity: { select: { code: true, name: true } },
        timeEntries: { select: { minutes: true, isBillable: true, billableRateCents: true } },
      },
      orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
    }),
    prisma.client.findMany({ where: { accountId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    listEntities(accountId),
  ])

  // Group by client for a Harvest-style grouped table (client header links to the client).
  const byClient = new Map<string, { id: string; name: string; projects: typeof projects }>()
  for (const p of projects) {
    const g = byClient.get(p.client.id) ?? { id: p.client.id, name: p.client.name, projects: [] }
    g.projects.push(p)
    byClient.set(p.client.id, g)
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Projects</h1>
      <p className="mb-6 text-sm text-gray-500">
        Live from Supabase · {projects.length} project{projects.length === 1 ? '' : 's'}
      </p>

      {canManage && <NewProjectForm clients={clients} entities={entities.map((e) => ({ id: e.id, name: e.name, code: e.code }))} />}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Project</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 text-right font-medium">Spent</th>
              <th className="px-4 py-3 text-right font-medium">Billable</th>
              <th className="px-4 py-3 text-right font-medium">Budget</th>
            </tr>
          </thead>
          <tbody>
            {[...byClient.values()].map((g) => (
              <ClientGroup key={g.id} clientId={g.id} clientName={g.name} projects={g.projects} />
            ))}
            {projects.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  No projects yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ClientGroup({
  clientId,
  clientName,
  projects,
}: {
  clientId: string
  clientName: string
  projects: {
    id: string
    name: string
    code: string | null
    projectType: string
    budgetMethod: string
    budgetValue: number | null
    entity: { code: string; name: string } | null
    timeEntries: { minutes: number; isBillable: boolean; billableRateCents: number | null }[]
  }[]
}) {
  return (
    <>
      <tr className="bg-gray-50">
        <td colSpan={5} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          <Link href={`/clients/${clientId}`} className="hover:text-brand-teal">
            {clientName}
          </Link>
        </td>
      </tr>
      {projects.map((p) => {
        const spentMinutes = p.timeEntries.reduce((s, e) => s + e.minutes, 0)
        const billableCents = p.timeEntries.reduce(
          (s, e) => s + (e.isBillable && e.billableRateCents ? Math.round((e.minutes / 60) * e.billableRateCents) : 0),
          0,
        )
        const badge = TYPE_BADGE[p.projectType] ?? TYPE_BADGE.non_billable
        return (
          <tr key={p.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
            <td className="px-4 py-3">
              <Link href={`/projects/${p.id}`} className="font-medium text-gray-900 hover:text-brand-teal">
                {p.code && <span className="text-gray-400">[{p.code}] </span>}
                {p.name}
              </Link>
              {p.entity && <span className="ml-2"><EntityChip code={p.entity.code} name={p.entity.name} /></span>}
            </td>
            <td className="px-4 py-3">
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                {badge.label}
              </span>
            </td>
            <td className="px-4 py-3 text-right text-gray-600">{hours(spentMinutes)}h</td>
            <td className="px-4 py-3 text-right">{billableCents > 0 ? formatCents(billableCents) : '—'}</td>
            <td className="px-4 py-3 text-right text-gray-600">{budgetLabel(p.budgetMethod, p.budgetValue)}</td>
          </tr>
        )
      })}
    </>
  )
}
