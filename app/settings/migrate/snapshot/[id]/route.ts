import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'

export const dynamic = 'force-dynamic'

/** Download a backup snapshot MANIFEST (metadata + per-part checksums). Small + bounded. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'edit_account_settings')) {
    return new Response('Forbidden', { status: 403 })
  }
  const snap = await prisma.migrationSnapshot.findFirst({
    where: { id: params.id, accountId },
    include: { parts: { select: { id: true, resource: true, chunk: true, rowCount: true, checksum: true }, orderBy: [{ resource: 'asc' }, { chunk: 'asc' }] } },
  })
  if (!snap) return new Response('Not found', { status: 404 })

  const body = JSON.stringify(
    {
      source: snap.source,
      capturedAt: snap.createdAt,
      status: snap.status,
      mode: snap.mode,
      counts: snap.entityCounts,
      meta: snap.meta,
      parts: snap.parts,
    },
    null,
    2,
  )
  const stamp = snap.createdAt.toISOString().slice(0, 10)
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="harvest-backup-manifest-${stamp}.json"`,
      'Cache-Control': 'no-store',
    },
  })
}
