import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'

export const dynamic = 'force-dynamic'

/** Download a single backup part's raw rows (bounded to one resource/year). Admin, account-scoped. */
export async function GET(_req: Request, { params }: { params: { id: string; partId: string } }) {
  const { accountId, permissionProfile } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile }, 'edit_account_settings')) {
    return new Response('Forbidden', { status: 403 })
  }
  const part = await prisma.migrationSnapshotPart.findFirst({
    where: { id: params.partId, snapshotId: params.id, accountId },
  })
  if (!part) return new Response('Not found', { status: 404 })

  const body = JSON.stringify(
    { resource: part.resource, chunk: part.chunk, rowCount: part.rowCount, checksum: part.checksum, rows: part.data },
    null,
    2,
  )
  const name = `harvest-${part.resource}${part.chunk ? `-${part.chunk}` : ''}.json`
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  })
}
