import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import Link from 'next/link'
import { NewTaskForm } from '@/components/NewTaskForm'
import { setTaskArchivedAction } from '@/app/tasks/actions'

export const dynamic = 'force-dynamic'

export default async function TasksPage({ searchParams }: { searchParams: { archived?: string } }) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  const canManage = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_tasks')
  const showArchived = searchParams.archived === '1'
  const tasks = await prisma.task.findMany({
    where: { accountId, ...(showArchived ? { NOT: { archivedAt: null } } : { archivedAt: null }) },
    orderBy: { name: 'asc' },
  })
  const common = tasks.filter((t) => t.autoAddToNewProjects)
  const other = tasks.filter((t) => !t.autoAddToNewProjects)

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-semibold">Tasks</h1>
          <p className="text-sm text-gray-500">Live from Supabase · {tasks.length} {showArchived ? 'archived ' : ''}tasks</p>
        </div>
        <Link href={showArchived ? '/tasks' : '/tasks?archived=1'} className="text-sm text-gray-500 hover:text-brand-teal">
          {showArchived ? '← Active tasks' : 'View archived'}
        </Link>
      </div>

      {canManage && !showArchived && <NewTaskForm />}

      <Section title="Common tasks" subtitle="Automatically added to all new projects." tasks={common} canManage={canManage} showArchived={showArchived} />
      <div className="h-6" />
      <Section title="Other tasks" subtitle="Must be added to projects manually." tasks={other} canManage={canManage} showArchived={showArchived} />
    </div>
  )
}

function Section({
  title,
  subtitle,
  tasks,
  canManage,
  showArchived,
}: {
  title: string
  subtitle: string
  tasks: { id: string; name: string; defaultBillable: boolean; defaultHourlyRateCents: number | null }[]
  canManage: boolean
  showArchived: boolean
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
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                  {t.defaultHourlyRateCents ? formatCents(t.defaultHourlyRateCents) : '—'}
                </td>
                {canManage && (
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {!showArchived && (
                        <Link href={`/tasks/${t.id}/edit`} className="text-gray-500 hover:text-brand-teal">Edit</Link>
                      )}
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
              <tr>
                <td colSpan={canManage ? 4 : 3} className="px-4 py-6 text-center text-gray-400">
                  None.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
