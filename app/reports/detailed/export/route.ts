import { requireUser } from '@/lib/session'
import { accountWeekStartsOn } from '@/lib/accountPrefs'
import { csvStreamResponse, EXPORT_BATCH } from '@/lib/csvStream'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { parseDetailed, detailedTimeframe } from '@/modules/reports/detailed'
import { detailedTimeBatch, type DetailedExportCursor } from '@/modules/reports/detailedTimeExport'
import type { DetailedTimeRow } from '@/modules/reports/detailedSql'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // all-time exports stream ~200 batches

const ymd = (d: Date) => new Date(d).toISOString().slice(0, 10)

/**
 * Detailed time report → CSV, same filters and order as the screen, every matching entry (no row cap).
 * Streamed in keyset-paginated batches so "All time" never loads every entry into memory.
 */
export async function GET(req: Request) {
  const me = await requireUser()
  const canRunAll = can({ permissionProfile: me.permissionProfile as PermissionProfile, permissionOverrides: me.permissionOverrides }, 'run_account_reports')
  const f = parseDetailed('time', Object.fromEntries(new URL(req.url).searchParams))
  const tf = detailedTimeframe(f, { weekStartsOn: await accountWeekStartsOn(me.accountId) })
  const scope = { accountId: me.accountId, onlyUserId: canRunAll ? null : me.userId }

  const toRow = (r: DetailedTimeRow) => {
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
  }

  async function* batches() {
    let after: DetailedExportCursor | null = null
    for (;;) {
      const page = await detailedTimeBatch(f, tf, scope, after, EXPORT_BATCH)
      if (page.rows.length) yield page.rows.map(toRow)
      if (!page.next) return
      after = page.next
    }
  }

  return csvStreamResponse(
    `detailed-time-${tf.from ? ymd(tf.from) : 'all'}${tf.till ? `-to-${ymd(tf.till)}` : ''}.csv`,
    ['Date', 'Client', 'Project', 'Task', 'Notes', 'Hours', 'Billable?', 'Invoiced?', 'Billable rate', 'Billable amount', 'Person', 'Roles'],
    batches,
  )
}
