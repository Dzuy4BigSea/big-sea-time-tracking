import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'

export const dynamic = 'force-dynamic'

/** Download a migration backup snapshot as a JSON file. Admin-gated, account-scoped. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { accountId, permissionProfile } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile }, 'edit_account_settings')) {
    return new Response('Forbidden', { status: 403 })
  }
  const snap = await prisma.migrationSnapshot.findFirst({ where: { id: params.id, accountId } })
  if (!snap) return new Response('Not found', { status: 404 })

  const body = JSON.stringify(
    { source: snap.source, capturedAt: snap.createdAt, counts: snap.entityCounts, data: snap.data },
    null,
    2,
  )
  const stamp = snap.createdAt.toISOString().slice(0, 10)
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="harvest-backup-${stamp}.json"`,
      'Cache-Control': 'no-store',
    },
  })
}
