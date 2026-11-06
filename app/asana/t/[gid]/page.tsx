import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { formatDate } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { visibleTaskEntries } from '@/lib/asanaApp'
import { asanaTaskUrl } from '@/modules/integrations/externalRef'
import { formatMinutes, type TimeDisplay } from '@/modules/shared/duration'
import { computeTimerMinutes } from '@/modules/time/timeEntry'

export const dynamic = 'force-dynamic'

const LIMIT = 500

/**
 * Time tracked against one Asana task (specs/29): where the Track2 card on the Asana task links to.
 * Shows only entries the viewer may see (same scope as the card).
 */
export default async function AsanaTaskTimePage({ params }: { params: { gid: string } }) {
  if (!/^\d{1,32}$/.test(params.gid)) notFound()
  const me = await requireUser()
  const { visible, scope } = await visibleTaskEntries(me, params.gid)
  const [entries, account, agg, running] = await Promise.all([
    prisma.timeEntry.findMany({
      where: visible,
      orderBy: [{ spentDate: 'desc' }, { createdAt: 'desc' }],
      take: LIMIT,
      select: {
        id: true, spentDate: true, minutes: true, notes: true, isRunning: true, timerStartedAt: true, externalPermalink: true, externalGroupId: true,
        user: { select: { firstName: true, lastName: true } },
        project: { select: { name: true, client: { select: { name: true } } } },
        task: { select: { name: true } },
      },
    }),
    prisma.account.findUnique({ where: { id: me.accountId }, select: { timeDisplay: true } }),
    prisma.timeEntry.aggregate({ where: visible, _sum: { minutes: true } }),
    prisma.timeEntry.findMany({ where: { AND: [visible, { isRunning: true }] }, select: { timerStartedAt: true } }),
  ])
  const display = (account?.timeDisplay ?? 'hh_mm') as TimeDisplay
  const now = new Date()
  const minutesOf = (e: (typeof entries)[number]) => e.minutes + (e.isRunning && e.timerStartedAt ? computeTimerMinutes(e.timerStartedAt, now) : 0)
  const total = (agg._sum.minutes ?? 0) + running.reduce((m, r) => m + (r.timerStartedAt ? computeTimerMinutes(r.timerStartedAt, now) : 0), 0)
  const link = entries.find((e) => e.externalPermalink)?.externalPermalink ?? asanaTaskUrl(params.gid, entries[0]?.externalGroupId)

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Asana task time</h1>
      <p className="mb-6 text-sm text-gray-500">
        {formatMinutes(total, display)} tracked{scope === 'self' ? ' by you' : ''} ·{' '}
        <a href={link} target="_blank" rel="noopener noreferrer" className="text-brand-teal hover:underline">
          Open the task in Asana
        </a>
      </p>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Person</th>
              <th className="px-4 py-3 font-medium">Project / task</th>
              <th className="px-4 py-3 font-medium">Notes</th>
              <th className="px-4 py-3 text-right font-medium">Hours</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-gray-100 last:border-0">
                <td className="whitespace-nowrap px-4 py-3 text-gray-500">{formatDate(e.spentDate)}</td>
                <td className="px-4 py-3 text-gray-900">{`${e.user.firstName} ${e.user.lastName}`.trim()}</td>
                <td className="px-4 py-3 text-gray-700">
                  {e.project.name} <span className="text-gray-400">({e.project.client.name})</span>
                  <div className="text-xs text-gray-500">{e.task.name}</div>
                </td>
                <td className="px-4 py-3 text-gray-600">{e.notes ?? ''}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                  {formatMinutes(minutesOf(e), display)}
                  {e.isRunning && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Running</span>}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">No time you can see is linked to this Asana task.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {entries.length === LIMIT && <p className="mt-3 text-xs text-gray-500">Showing the latest {LIMIT} entries.</p>}
    </div>
  )
}
