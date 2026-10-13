import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { csvStreamResponse, EXPORT_BATCH } from '@/lib/csvStream'
import { EXPORT_TABLES, exportColumns, exportTableBatches, isExportTable } from '@/modules/export/fullExport'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 388k time entries stream in ~200 batches

/** Settings → Data export: one table of this account as a streamed CSV. Admins only. */
export async function GET(_req: Request, { params }: { params: { table: string } }) {
  const me = await requireUser()
  if (!can({ permissionProfile: me.permissionProfile as PermissionProfile, permissionOverrides: me.permissionOverrides }, 'edit_account_settings')) {
    return new Response('Forbidden', { status: 403 })
  }
  if (!isExportTable(params.table)) return new Response('Not found', { status: 404 })
  const { table } = EXPORT_TABLES[params.table]
  const columns = await exportColumns(table)
  const stamp = new Date().toISOString().slice(0, 10)
  return csvStreamResponse(
    `track2-${params.table}-${stamp}.csv`,
    columns.map((c) => c.name),
    () => exportTableBatches(table, columns, me.accountId, EXPORT_BATCH),
  )
}
