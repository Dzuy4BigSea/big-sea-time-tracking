import { requireUser } from '@/lib/session'
import { accountWeekStartsOn } from '@/lib/accountPrefs'
import { toCsv, csvResponse } from '@/lib/csv'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { parseDetailed, detailedTimeframe } from '@/modules/reports/detailed'
import { detailedExpenses } from '@/modules/reports/detailedSql'

export const dynamic = 'force-dynamic'

const ymd = (d: Date) => new Date(d).toISOString().slice(0, 10)

/** Detailed expense report → CSV, same filters as the screen, every matching expense. */
export async function GET(req: Request) {
  const me = await requireUser()
  const canRunAll = can({ permissionProfile: me.permissionProfile as PermissionProfile, permissionOverrides: me.permissionOverrides }, 'run_account_reports')
  const f = parseDetailed('expense', Object.fromEntries(new URL(req.url).searchParams))
  const tf = detailedTimeframe(f, { weekStartsOn: await accountWeekStartsOn(me.accountId) })
  const data = await detailedExpenses(f, tf, { accountId: me.accountId, onlyUserId: canRunAll ? null : me.userId }, null)

  const rows = data.rows.map((r) => [
    ymd(r.spentDate),
    r.clientName,
    r.projectCode ? `[${r.projectCode}] ${r.projectName}` : r.projectName,
    r.categoryName,
    r.notes ?? '',
    (r.totalCents / 100).toFixed(2),
    r.isBillable ? 'Yes' : 'No',
    r.invoiced ? 'Yes' : 'No',
    r.userName,
  ])
  const csv = toCsv(['Date', 'Client', 'Project', 'Category', 'Notes', 'Amount', 'Billable?', 'Invoiced?', 'Person'], rows)
  return csvResponse(`detailed-expenses-${tf.from ? ymd(tf.from) : 'all'}${tf.till ? `-to-${ymd(tf.till)}` : ''}.csv`, csv)
}
