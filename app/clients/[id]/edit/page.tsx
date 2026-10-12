import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { EditClientForm } from '@/components/EditClientForm'
import { listEntities } from '@/lib/entities'
import { setClientArchivedAction } from '@/app/clients/actions'

export const dynamic = 'force-dynamic'

export default async function EditClientPage({ params }: { params: { id: string } }) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_clients')) {
    redirect('/clients')
  }

  const [client, entities] = await Promise.all([
    prisma.client.findFirst({
      where: { id: params.id, accountId },
      select: { id: true, name: true, currency: true, address: true, entityId: true, isActive: true, _count: { select: { invoices: true } } },
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
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <div className="flex-1">
          <EditClientForm
            client={{ id: client.id, name: client.name, currency: client.currency, address: client.address, entityId: client.entityId }}
            currencyLocked={client._count.invoices > 0}
            entities={entities.map((e) => ({ id: e.id, name: e.name, code: e.code }))}
          />
        </div>
        <aside className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm md:w-64">
          <form action={setClientArchivedAction}>
            <input type="hidden" name="id" value={client.id} />
            <input type="hidden" name="archived" value={client.isActive ? 'on' : 'off'} />
            <button className="text-left text-brand-teal hover:underline">
              {client.isActive ? `Archive “${client.name}”` : `Reactivate “${client.name}”`}
            </button>
          </form>
          <p className="mt-1 text-xs text-gray-500">
            {client.isActive ? 'Archived clients leave the active clients list; find them under Actions → View archived clients.' : 'This client is archived.'}
          </p>
        </aside>
      </div>
    </div>
  )
}
