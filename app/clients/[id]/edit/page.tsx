import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { EditClientForm } from '@/components/EditClientForm'
import { listEntities } from '@/lib/entities'

export const dynamic = 'force-dynamic'

export default async function EditClientPage({ params }: { params: { id: string } }) {
  const { accountId, permissionProfile } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile }, 'manage_clients')) {
    redirect('/clients')
  }

  const [client, entities] = await Promise.all([
    prisma.client.findFirst({
      where: { id: params.id, accountId },
      select: { id: true, name: true, currency: true, address: true, entityId: true, _count: { select: { invoices: true } } },
    }),
    listEntities(accountId),
  ])
  if (!client) notFound()

  return (
    <div>
      <Link href="/clients" className="text-sm text-gray-500 hover:text-brand-teal">
        ← Back to Clients
      </Link>
      <h1 className="mb-4 mt-2 text-2xl font-semibold">Edit client</h1>
      <EditClientForm
        client={{ id: client.id, name: client.name, currency: client.currency, address: client.address, entityId: client.entityId }}
        currencyLocked={client._count.invoices > 0}
        entities={entities.map((e) => ({ id: e.id, name: e.name, code: e.code }))}
      />
    </div>
  )
}
