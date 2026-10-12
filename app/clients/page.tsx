import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { EntityChip } from '@/components/EntitySelect'
import { LiveSearchInput } from '@/components/LiveFilters'
import {
  clientListWhere,
  contactName,
  contactSubline,
  paginate,
  parseClientStatus,
  sortClientsByName,
} from '@/modules/clients/clientList'

export const dynamic = 'force-dynamic'

/** Manage > Clients — one card per client with its contacts, as in Harvest (specs/24 §3). */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: { status?: string; q?: string; page?: string }
}) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  const canManage = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_clients')

  const status = parseClientStatus(searchParams.status)
  const q = (searchParams.q ?? '').trim()

  const [matching, activeCount, archivedCount, arRows] = await Promise.all([
    prisma.client.findMany({
      where: clientListWhere(accountId, status, q),
      select: { id: true, name: true, isActive: true, entity: { select: { code: true, name: true } } },
    }),
    prisma.client.count({ where: { accountId, isActive: true } }),
    prisma.client.count({ where: { accountId, isActive: false } }),
    prisma.$queryRaw<{ open: bigint }[]>`
      SELECT COALESCE(SUM("totalCents" - "paidCents"),0)::bigint AS open
      FROM "Invoice" WHERE "accountId" = ${accountId} AND status::text = 'open'`,
  ])
  const totalOutstanding = Number(arRows[0]?.open ?? 0)

  const { items: clients, page, pages } = paginate(sortClientsByName(matching), searchParams.page)
  const contacts = clients.length
    ? await prisma.clientContact.findMany({
        where: { accountId, clientId: { in: clients.map((c) => c.id) } },
        select: { id: true, clientId: true, firstName: true, lastName: true, title: true, email: true, phoneOffice: true, phoneMobile: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      })
    : []
  const contactsBy = new Map<string, typeof contacts>()
  for (const ct of contacts) {
    const list = contactsBy.get(ct.clientId) ?? []
    list.push(ct)
    contactsBy.set(ct.clientId, list)
  }

  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    const merged = { status: status === 'active' ? undefined : status, q: q || undefined, ...over }
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v)
    const s = p.toString()
    return s ? `/clients?${s}` : '/clients'
  }

  const editBtn = 'rounded border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50'
  const menuItem = 'block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50'
  const statusLabel = status === 'archived' ? 'Archived clients' : status === 'all' ? 'All clients' : null

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <span className="ml-3 text-sm text-gray-500">
          Total outstanding <span className="font-semibold text-gray-800">{formatCents(totalOutstanding)}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          {canManage && (
            <Link href="/clients/new" className="rounded bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
              + New client
            </Link>
          )}
          <details className="relative">
            <summary className="cursor-pointer list-none rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
              Actions ▾
            </summary>
            <div className="absolute right-0 z-10 mt-1 w-52 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              {status !== 'active' && <Link href={href({ status: undefined, page: undefined })} className={menuItem}>View active clients ({activeCount})</Link>}
              {status !== 'archived' && <Link href={href({ status: 'archived', page: undefined })} className={menuItem}>View archived clients ({archivedCount})</Link>}
              {status !== 'all' && <Link href={href({ status: 'all', page: undefined })} className={menuItem}>View all clients</Link>}
            </div>
          </details>
        </div>
      </div>

      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <LiveSearchInput
            param="q"
            placeholder="Filter by client or contact"
            className="w-72 rounded border border-gray-300 px-3 py-1.5 text-sm"
            activeClassName="border-orange-300 bg-orange-50"
            clearLabel="Clear filter"
            resetParams={['page']}
          />
          {statusLabel && (
            <span className="text-sm text-gray-500">
              Showing {statusLabel.toLowerCase()} ·{' '}
              <Link href={href({ status: undefined, page: undefined })} className="text-brand-teal hover:underline">View active clients</Link>
            </span>
          )}
          <span className="ml-auto text-sm text-gray-400">
            {matching.length} {matching.length === 1 ? 'client' : 'clients'}
          </span>
        </div>

        <div className="space-y-3">
          {clients.map((c) => {
            const list = contactsBy.get(c.id) ?? []
            return (
              <section key={c.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                <div className="flex items-center gap-3 bg-gray-50 px-4 py-2.5">
                  {canManage && (
                    <Link href={`/clients/${c.id}/edit`} className={editBtn}>
                      Edit
                    </Link>
                  )}
                  <Link href={`/clients/${c.id}`} className="font-semibold text-gray-900 hover:text-brand-teal">
                    {c.name}
                  </Link>
                  {c.entity && <EntityChip code={c.entity.code} name={c.entity.name} />}
                  {!c.isActive && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">Archived</span>}
                  {canManage && (
                    <Link href={`/clients/${c.id}/contacts/new`} className={`ml-auto ${editBtn}`}>
                      + Add contact
                    </Link>
                  )}
                </div>
                {list.length > 0 && (
                  <ul className="divide-y divide-gray-100 border-t border-gray-200">
                    {list.map((ct) => {
                      const sub = contactSubline(ct)
                      return (
                        <li key={ct.id} className="flex items-start gap-3 px-4 py-2">
                          {canManage && (
                            <Link href={`/clients/${c.id}/contacts/${ct.id}/edit`} className={`mt-0.5 ${editBtn}`}>
                              Edit
                            </Link>
                          )}
                          <div className="min-w-0">
                            <div className="text-sm text-gray-900">{contactName(ct)}</div>
                            {sub && <div className="break-words text-xs text-gray-500">{sub}</div>}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )
          })}
          {clients.length === 0 && (
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
              {q ? 'No clients or contacts match that filter.' : 'No clients yet.'}
            </div>
          )}
        </div>

        {pages > 1 && (
          <nav className="mt-4 flex items-center justify-center gap-3 text-sm">
            {page > 1 ? (
              <Link href={href({ page: String(page - 1) })} className="text-brand-teal hover:underline">← Previous</Link>
            ) : (
              <span className="text-gray-300">← Previous</span>
            )}
            <span className="text-gray-500">Page {page} of {pages}</span>
            {page < pages ? (
              <Link href={href({ page: String(page + 1) })} className="text-brand-teal hover:underline">Next →</Link>
            ) : (
              <span className="text-gray-300">Next →</span>
            )}
          </nav>
        )}
      </div>
    </div>
  )
}
