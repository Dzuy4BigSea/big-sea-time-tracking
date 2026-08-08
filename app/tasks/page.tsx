import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import Link from 'next/link'
import { NewTaskForm } from '@/components/NewTaskForm'
import { setTaskArchivedAction } from '@/app/tasks/actions'

export const dynamic = 'force-dynamic'

const hrs = (m: number) => (m / 60).toLocaleString('en-US', { maximumFractionDigits: 0 })

type UsageMaps = { projectsBy: Map<string, number>; hoursBy: Map<string, number> }

export default async function TasksPage({ searchParams }: { searchParams: { status?: string; q?: string } }) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  const canManage = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_tasks')

  const status = ['active', 'archived', 'all'].includes(searchParams.status ?? '') ? searchParams.status! : 'active'
  const q = (searchParams.q ?? '').trim()

  const [tasks, activeCount, projAgg, hoursAgg] = await Promise.all([
    prisma.task.findMany({
      where: {
        accountId,
        ...(status === 'active' ? { archivedAt: null } : status === 'archived' ? { NOT: { archivedAt: null } } : {}),
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
    }),
    prisma.task.count({ where: { accountId, archivedAt: null } }),
    prisma.projectTaskAssignment.groupBy({ by: ['taskId'], where: { accountId }, _count: { _all: true } }),
    prisma.timeEntry.groupBy({ by: ['taskId'], where: { accountId }, _sum: { minutes: true } }),
  ])
  const usage: UsageMaps = {
    projectsBy: new Map(projAgg.map((r) => [r.taskId, r._count._all])),
    hoursBy: new Map(hoursAgg.map((r) => [r.taskId, r._sum.minutes ?? 0])),
  }

  const showArchived = status === 'archived'
  const common = tasks.filter((t) => t.autoAddToNewProjects)
  const other = tasks.filter((t) => !t.autoAddToNewProjects)
  const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <span className="text-sm text-gray-400">{tasks.length} shown</span>
      </div>

      {canManage && status !== 'archived' && <NewTaskForm />}

      {/* Filters */}
      <form className="mb-4 flex flex-wrap items-center gap-2">
        <select name="status" defaultValue={status} className={input}>
          <option value="active">Active tasks ({activeCount})</option>
          <option value="archived">Archived tasks</option>
          <option value="all">All tasks</option>
        </select>
        <input name="q" defaultValue={q} placeholder="Search tasks" className={`${input} w-56`} />
        <button className="rounded bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">Apply</button>
        {(q || status !== 'active') && <Link href="/tasks" className="text-sm text-gray-400 hover:text-gray-600">Clear</Link>}
      </form>

      <Section title="Common tasks" subtitle="Automatically added to all new projects." tasks={common} canManage={canManage} showArchived={showArchived} usage={usage} />
      <div className="h-6" />
      <Section title="Other tasks" subtitle="Must be added to projects manually." tasks={other} canManage={canManage} showArchived={showArchived} usage={usage} />
    </div>
  )
}

function Section({
  title, subtitle, tasks, canManage, showArchived, usage,
}: {
  title: string
  subtitle: string
  tasks: { id: string; name: string; defaultBillable: boolean; defaultHourlyRateCents: number | null }[]
  canManage: boolean
  showArchived: boolean
  usage: UsageMaps
}) {
  return (
    <div>
      <div className="mb-2">
        <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
        <p className="text-xs text-gray-400">{subtitle}</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Task</th>
              <th className="px-4 py-3 font-medium">Billable</th>
              <th className="px-4 py-3 text-right font-medium">Default rate</th>
              <th className="px-4 py-3 text-right font-medium">Projects</th>
              <th className="px-4 py-3 text-right font-medium">Hours tracked</th>
              {canManage && <th className="px-4 py-3 text-right font-medium">Edit</th>}
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 font-medium text-gray-900">{t.name}</td>
                <td className="px-4 py-3">
                  {t.defaultBillable ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Billable</span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">Non-billable</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{t.defaultHourlyRateCents ? formatCents(t.defaultHourlyRateCents) : '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">{usage.projectsBy.get(t.id) ?? 0}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">{hrs(usage.hoursBy.get(t.id) ?? 0)}</td>
                {canManage && (
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {!showArchived && <Link href={`/tasks/${t.id}/edit`} className="text-gray-500 hover:text-brand-teal">Edit</Link>}
                      <form action={setTaskArchivedAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="archived" value={showArchived ? 'off' : 'on'} />
                        <button className="text-xs text-gray-400 hover:text-brand-teal">{showArchived ? 'Restore' : 'Archive'}</button>
                      </form>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr><td colSpan={canManage ? 6 : 5} className="px-4 py-6 text-center text-gray-400">None.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
