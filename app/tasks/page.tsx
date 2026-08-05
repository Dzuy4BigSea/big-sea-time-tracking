import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { NewTaskForm } from '@/components/NewTaskForm'

export const dynamic = 'force-dynamic'

export default async function TasksPage() {
  const { accountId, permissionProfile } = await requireUser()
  const canManage = can({ permissionProfile: permissionProfile as PermissionProfile }, 'manage_tasks')
  const tasks = await prisma.task.findMany({
    where: { accountId, archivedAt: null },
    orderBy: { name: 'asc' },
  })
  const common = tasks.filter((t) => t.autoAddToNewProjects)
  const other = tasks.filter((t) => !t.autoAddToNewProjects)

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Tasks</h1>
      <p className="mb-6 text-sm text-gray-500">Live from Supabase · {tasks.length} tasks</p>

      {canManage && <NewTaskForm />}

      <Section
        title="Common tasks"
        subtitle="Automatically added to all new projects."
        tasks={common}
      />
      <div className="h-6" />
      <Section title="Other tasks" subtitle="Must be added to projects manually." tasks={other} />
    </div>
  )
}

function Section({
  title,
  subtitle,
  tasks,
}: {
  title: string
  subtitle: string
  tasks: { id: string; name: string; defaultBillable: boolean; defaultHourlyRateCents: number | null }[]
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
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-gray-400">
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
