import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { formatCents, formatDate } from '@/lib/format'
import { formatMinutes } from '@/modules/shared/duration'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<string, string> = {
  time_and_materials: 'Time & Materials',
  fixed_fee: 'Fixed Fee',
  non_billable: 'Non-Billable',
}

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({
    where: { id: params.id },
    include: {
      client: true,
      userAssignments: { include: { user: { select: { firstName: true, lastName: true } } } },
      timeEntries: {
        include: { user: { select: { firstName: true, lastName: true } }, task: { select: { name: true } } },
        orderBy: { spentDate: 'desc' },
      },
    },
  })
  if (!project) notFound()

  const spentMin = project.timeEntries.reduce((s, e) => s + e.minutes, 0)
  const billableCents = project.timeEntries.reduce(
    (s, e) => s + (e.isBillable && e.billableRateCents ? Math.round((e.minutes / 60) * e.billableRateCents) : 0),
    0,
  )
  const invoicedCents = project.timeEntries.reduce(
    (s, e) => s + (e.lockState === 'invoiced' && e.billableRateCents ? Math.round((e.minutes / 60) * e.billableRateCents) : 0),
    0,
  )
  const uninvoicedCents = billableCents - invoicedCents
  const budgetHoursMin =
    project.budgetMethod.startsWith('hours') && project.budgetValue ? project.budgetValue : null

  return (
    <div>
      <Link href="/projects" className="text-sm text-gray-500 hover:text-brand-orange">
        ← Back to Projects
      </Link>

      <div className="mb-1 mt-2 text-xs text-gray-400">{project.client.name}</div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">
          {project.code ? `[${project.code}] ` : ''}
          {project.name}
        </h1>
        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
          {TYPE_LABEL[project.projectType] ?? project.projectType}
        </span>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Tracked" value={formatMinutes(spentMin)} />
        <Stat label="Budget" value={budgetHoursMin ? formatMinutes(budgetHoursMin) : project.projectFeesCents ? formatCents(project.projectFeesCents) : '—'} />
        <Stat label="Invoiced" value={formatCents(invoicedCents)} />
        <Stat label="Uninvoiced" value={formatCents(uninvoicedCents)} accent="text-brand-green" />
      </div>

      {project.userAssignments.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Team</h2>
          <div className="flex flex-wrap gap-2">
            {project.userAssignments.map((a) => (
              <span key={a.id} className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                {a.user.firstName} {a.user.lastName}
                {a.isProjectManager && <span className="ml-1 text-xs text-brand-orange">PM</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Recent time</h2>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Person</th>
              <th className="px-4 py-3 font-medium">Task</th>
              <th className="px-4 py-3 text-right font-medium">Hours</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {project.timeEntries.slice(0, 25).map((e) => (
              <tr key={e.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 text-gray-600">{formatDate(e.spentDate)}</td>
                <td className="px-4 py-3 text-gray-700">
                  {e.user.firstName} {e.user.lastName}
                </td>
                <td className="px-4 py-3 text-gray-600">{e.task.name}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {e.isRunning ? <span className="text-brand-orange">▶</span> : formatMinutes(e.minutes)}
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">{e.isBillable ? e.lockState : 'non-billable'}</td>
              </tr>
            ))}
            {project.timeEntries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  No time tracked yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${accent ?? 'text-gray-900'}`}>{value}</div>
    </div>
  )
}
