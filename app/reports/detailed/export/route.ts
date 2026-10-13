import { requireUser } from '@/lib/session'
import { accountWeekStartsOn } from '@/lib/accountPrefs'
import { toCsv, csvResponse } from '@/lib/csv'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { parseDetailed, detailedTimeframe } from '@/modules/reports/detailed'
import { detailedTime } from '@/modules/reports/detailedSql'

export const dynamic = 'force-dynamic'

const ymd = (d: Date) => new Date(d).toISOString().slice(0, 10)

/** Detailed time report → CSV, same filters as the screen, every matching entry (no row cap). */
export async function GET(req: Request) {
  const me = await requireUser()
  const canRunAll = can({ permissionProfile: me.permissionProfile as PermissionProfile, permissionOverrides: me.permissionOverrides }, 'run_account_reports')
  const f = parseDetailed('time', Object.fromEntries(new URL(req.url).searchParams))
  const tf = detailedTimeframe(f, { weekStartsOn: await accountWeekStartsOn(me.accountId) })
  const data = await detailedTime(f, tf, { accountId: me.accountId, onlyUserId: canRunAll ? null : me.userId }, null)

  const rows = data.rows.map((r) => {
    const amount = r.isBillable && r.billableRateCents ? Math.round((r.minutes / 60) * r.billableRateCents) : 0
    return [
      ymd(r.spentDate),
      r.clientName,
      r.projectCode ? `[${r.projectCode}] ${r.projectName}` : r.projectName,
      r.taskName,
      r.notes ?? '',
      (r.minutes / 60).toFixed(2),
      r.isBillable ? 'Yes' : 'No',
      r.invoiced ? 'Yes' : 'No',
      r.billableRateCents != null ? (r.billableRateCents / 100).toFixed(2) : '',
      amount ? (amount / 100).toFixed(2) : '',
      r.userName,
      (r.roles ?? []).join(', '),
    ]
  })
  const csv = toCsv(['Date', 'Client', 'Project', 'Task', 'Notes', 'Hours', 'Billable?', 'Invoiced?', 'Billable rate', 'Billable amount', 'Person', 'Roles'], rows)
  return csvResponse(`detailed-time-${tf.from ? ymd(tf.from) : 'all'}${tf.till ? `-to-${ymd(tf.till)}` : ''}.csv`, csv)
}
