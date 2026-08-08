import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { formatCents } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { NewProjectForm } from '@/components/NewProjectForm'
import { EntityChip } from '@/components/EntitySelect'
import { ClickableRow } from '@/components/ClickableRow'
import { listEntities } from '@/lib/entities'
import { setProjectArchivedAction } from '@/app/projects/actions'

export const dynamic = 'force-dynamic'

const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  time_and_materials: { label: 'T&M', className: 'bg-blue-100 text-blue-700' },
  fixed_fee: { label: 'Fixed Fee', className: 'bg-purple-100 text-purple-700' },
  non_billable: { label: 'Non-Billable', className: 'bg-gray-100 text-gray-600' },
}
const HOURS_BUDGETS = new Set(['hours_total', 'hours_per_task', 'hours_per_person'])
const hours = (m: number) => (m / 60).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: { status?: string; client?: string; manager?: string; q?: string }
}) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  const canManage = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_projects')

  const status = ['active', 'archived', 'all'].includes(searchParams.status ?? '') ? searchParams.status! : 'active'
  const clientId = searchParams.client || ''
  const managerId = searchParams.manager || ''
  const q = (searchParams.q ?? '').trim()

  const where: Prisma.ProjectWhereInput = {
    accountId,
    ...(status === 'active' ? { isActive: true } : status === 'archived' ? { isActive: false } : {}),
    ...(clientId ? { clientId } : {}),
    ...(managerId ? { userAssignments: { some: { userId: managerId, isProjectManager: true } } } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }, { client: { name: { contains: q, mode: 'insensitive' } } }] } : {}),
  }

  const [projects, activeCount, clients, managerRows, entities] = await Promise.all([
    prisma.project.findMany({
      where,
      select: {
        id: true, name: true, code: true, projectType: true, budgetMethod: true, budgetValue: true, budgetResetsMonthly: true, projectFeesCents: true, isActive: true,
        client: { select: { id: true, name: true } },
        entity: { select: { code: true, name: true } },
      },
      orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
    }),
    prisma.project.count({ where: { accountId, isActive: true } }),
    prisma.client.findMany({ where: { accountId, projects: { some: {} } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.projectUserAssignment.findMany({ where: { accountId, isProjectManager: true }, select: { user: { select: { id: true, firstName: true, lastName: true } } }, distinct: ['userId'] }),
    listEntities(accountId),
  ])

  // Current month window — for projects whose budget resets monthly, spent/remaining are scoped to it.
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))

  const ids = projects.map((p) => p.id)
  const [spentAgg, spentMonthAgg, expenseAgg] = await Promise.all([
    ids.length ? prisma.timeEntry.groupBy({ by: ['projectId'], where: { accountId, projectId: { in: ids } }, _sum: { minutes: true } }) : Promise.resolve([]),
    ids.length ? prisma.timeEntry.groupBy({ by: ['projectId'], where: { accountId, projectId: { in: ids }, spentDate: { gte: monthStart, lt: monthEnd } }, _sum: { minutes: true } }) : Promise.resolve([]),
    ids.length ? prisma.expense.groupBy({ by: ['projectId'], where: { accountId, projectId: { in: ids } }, _sum: { totalCents: true } }) : Promise.resolve([]),
  ])
  const spentBy = new Map(spentAgg.map((r) => [r.projectId, r._sum.minutes ?? 0]))
  const spentMonthBy = new Map(spentMonthAgg.map((r) => [r.projectId, r._sum.minutes ?? 0]))
  const costBy = new Map(expenseAgg.map((r) => [r.projectId, r._sum.totalCents ?? 0]))

  // Distinct managers for the filter dropdown.
  const managers = managerRows
    .map((r) => r.user)
    .sort((a, b) => (a.firstName + a.lastName).localeCompare(b.firstName + b.lastName))

  // Group by client for the Harvest-style grouped table.
  const groups = new Map<string, { id: string; name: string; projects: typeof projects }>()
  for (const p of projects) {
    const g = groups.get(p.client.id) ?? { id: p.client.id, name: p.client.name, projects: [] as typeof projects }
    g.projects.push(p)
    groups.set(p.client.id, g)
  }

  const qp = (over: Record<string, string>) => {
    const p = new URLSearchParams({ ...(status !== 'active' ? { status } : {}), ...(clientId ? { client: clientId } : {}), ...(managerId ? { manager: managerId } : {}), ...(q ? { q } : {}), ...over })
    const s = p.toString()
    return s ? `/projects?${s}` : '/projects'
  }

  const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <a href="/projects/export" className="text-sm text-gray-500 hover:text-brand-teal">Export CSV</a>
      </div>

      {canManage && <NewProjectForm clients={clients} entities={entities.map((e) => ({ id: e.id, name: e.name, code: e.code }))} />}

      {/* Filter controls */}
      <form className="mb-4 flex flex-wrap items-center gap-2">
        <select name="status" defaultValue={status} className={input}>
          <option value="active">Active projects ({activeCount})</option>
          <option value="archived">Archived projects</option>
          <option value="all">All projects</option>
        </select>
        <select name="client" defaultValue={clientId} className={input}>
          <option value="">Filter by client</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="manager" defaultValue={managerId} className={input}>
          <option value="">Filter by manager</option>
          {managers.map((m) => <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>)}
        </select>
        <input name="q" defaultValue={q} placeholder="Search by project or client" className={`${input} w-56`} />
        <button className="rounded bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">Apply</button>
        {(clientId || managerId || q || status !== 'active') && (
          <Link href="/projects" className="text-sm text-gray-400 hover:text-gray-600">Clear</Link>
        )}
        <span className="ml-auto text-sm text-gray-400">{projects.length} shown</span>
      </form>

      <div className="overflow-visible rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Client / Project</th>
              <th className="px-4 py-3 text-right font-medium">Budget</th>
              <th className="px-4 py-3 font-medium">Spent</th>
              <th className="px-4 py-3 text-right font-medium">Remaining</th>
              <th className="px-4 py-3 text-right font-medium">Costs</th>
              {canManage && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody>
            {[...groups.values()].map((g) => (
              <ClientGroup key={g.id} group={g} spentBy={spentBy} spentMonthBy={spentMonthBy} costBy={costBy} canManage={canManage} />
            ))}
            {projects.length === 0 && (
              <tr><td colSpan={canManage ? 6 : 5} className="px-4 py-8 text-center text-gray-400">No projects match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-400">Spent/remaining reflect all tracked time. Costs are expenses (labor cost joins once cost rates are imported).</p>
    </div>
  )
}

function ClientGroup({ group, spentBy, spentMonthBy, costBy, canManage }: any) {
  return (
    <>
      <tr className="bg-gray-50">
        <td colSpan={canManage ? 6 : 5} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          <Link href={`/clients/${group.id}`} className="hover:text-brand-teal">{group.name}</Link>
        </td>
      </tr>
      {group.projects.map((p: any) => {
        // Monthly-reset budgets track against THIS MONTH's spend; total budgets against all-time.
        const spentMin = (p.budgetResetsMonthly ? spentMonthBy.get(p.id) : spentBy.get(p.id)) ?? 0
        const costCents = costBy.get(p.id) ?? 0
        const badge = TYPE_BADGE[p.projectType] ?? TYPE_BADGE.non_billable
        const isHours = HOURS_BUDGETS.has(p.budgetMethod) && p.budgetValue
        const budgetMin = isHours ? p.budgetValue : 0
        const pctSpent = budgetMin ? Math.min(100, Math.round((spentMin / budgetMin) * 100)) : 0
        const remainingMin = budgetMin ? budgetMin - spentMin : 0
        const pctRemain = budgetMin ? Math.max(0, Math.round((remainingMin / budgetMin) * 100)) : 0
        const over = budgetMin ? spentMin > budgetMin : false
        return (
          <ClickableRow key={p.id} href={`/projects/${p.id}`} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
            <td className="px-4 py-3">
              <Link href={`/projects/${p.id}`} className="font-medium text-gray-900 hover:text-brand-teal">
                {p.code && <span className="text-gray-400">[{p.code}] </span>}{p.name}
              </Link>
              <span className={`ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>
              {p.entity && <span className="ml-2"><EntityChip code={p.entity.code} name={p.entity.name} /></span>}
            </td>
            <td className="px-4 py-3 text-right tabular-nums text-gray-600">
              {isHours ? hours(budgetMin) : p.budgetMethod === 'fee_total' && p.budgetValue ? formatCents(p.budgetValue) : p.projectFeesCents ? formatCents(p.projectFeesCents) : '—'}
              {p.budgetResetsMonthly && <span title="Monthly budget (resets)" className="ml-1 text-gray-400">↻</span>}
            </td>
            <td className="px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="w-12 tabular-nums text-gray-700">{hours(spentMin)}</span>
                {budgetMin ? (
                  <span className="h-2 w-28 overflow-hidden rounded-full bg-gray-100">
                    <span className="block h-full rounded-full" style={{ width: `${pctSpent}%`, background: over ? '#c9342c' : '#004348' }} />
                  </span>
                ) : null}
              </div>
            </td>
            <td className={`px-4 py-3 text-right tabular-nums ${over ? 'font-medium text-red-600' : 'text-gray-600'}`}>
              {budgetMin ? `${hours(remainingMin)} (${pctRemain}%)` : '—'}
            </td>
            <td className="px-4 py-3 text-right tabular-nums text-gray-500">{costCents > 0 ? formatCents(costCents) : '—'}</td>
            {canManage && (
              <td className="px-4 py-3 text-right">
                <details className="relative inline-block text-left">
                  <summary className="cursor-pointer list-none rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">Actions ▾</summary>
                  <div className="absolute right-0 z-10 mt-1 w-36 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-left shadow-lg">
                    <Link href={`/projects/${p.id}`} className="block px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">View</Link>
                    <Link href={`/projects/${p.id}/edit`} className="block px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">Edit</Link>
                    <form action={setProjectArchivedAction}>
                      <input type="hidden" name="projectId" value={p.id} />
                      <input type="hidden" name="archived" value={p.isActive ? 'on' : 'off'} />
                      <button className="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50">{p.isActive ? 'Archive' : 'Restore'}</button>
                    </form>
                  </div>
                </details>
              </td>
            )}
          </ClickableRow>
        )
      })}
    </>
  )
}
