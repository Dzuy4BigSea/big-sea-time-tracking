import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { NewClientForm } from '@/components/NewClientForm'
import { EntityChip } from '@/components/EntitySelect'
import { listEntities } from '@/lib/entities'

export const dynamic = 'force-dynamic'

export default async function ClientsPage() {
  const { accountId, permissionProfile } = await requireUser()
  const canManage = can({ permissionProfile: permissionProfile as PermissionProfile }, 'manage_clients')
  const [clients, entities] = await Promise.all([
    prisma.client.findMany({
      where: { accountId },
      include: {
        contacts: { orderBy: { isInvoiceRecipient: 'desc' } },
        entity: { select: { code: true, name: true } },
        _count: { select: { projects: true } },
      },
      orderBy: { name: 'asc' },
    }),
    listEntities(accountId),
  ])
  const entityOpts = entities.map((e) => ({ id: e.id, name: e.name, code: e.code }))

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Clients</h1>
      <p className="mb-6 text-sm text-gray-500">
        Live from Supabase · {clients.length} client{clients.length === 1 ? '' : 's'}
      </p>

      {canManage && <NewClientForm entities={entityOpts} />}

      <div className="space-y-3">
        {clients.map((c) => (
          <div key={c.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="flex items-center gap-2 font-semibold text-gray-900">
                <Link href={`/clients/${c.id}`} className="hover:text-brand-teal">
                  {c.name}
                </Link>
                {c.entity && <EntityChip code={c.entity.code} name={c.entity.name} />}
              </h2>
              <div className="flex items-baseline gap-3 text-xs text-gray-400">
                <span>
                  {c.currency} · {c._count.projects} project{c._count.projects === 1 ? '' : 's'}
                </span>
                {canManage && (
                  <Link href={`/clients/${c.id}/edit`} className="text-gray-500 hover:text-brand-teal">
                    Edit
                  </Link>
                )}
              </div>
            </div>
            {c.address && <div className="mt-1 whitespace-pre-line text-xs text-gray-500">{c.address}</div>}

            {c.contacts.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-sm">
                {c.contacts.map((ct) => (
                  <li key={ct.id} className="flex items-center gap-2">
                    <span className="font-medium text-gray-800">
                      {ct.firstName} {ct.lastName}
                    </span>
                    {ct.title && <span className="text-xs text-gray-400">{ct.title}</span>}
                    {ct.email && <span className="text-gray-500">{ct.email}</span>}
                    {ct.isInvoiceRecipient && (
                      <span className="rounded bg-brand-teal-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-teal">
                        invoices
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {clients.length === 0 && <p className="text-sm text-gray-400">No clients yet.</p>}
      </div>
    </div>
  )
}
