import Link from 'next/link'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { NewClientForm } from '@/components/NewClientForm'
import { EntityChip } from '@/components/EntitySelect'
import { ClickableRow } from '@/components/ClickableRow'
import { listEntities } from '@/lib/entities'
import { setClientArchivedAction } from '@/app/clients/actions'

export const dynamic = 'force-dynamic'

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: { status?: string; q?: string }
}) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  const canManage = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_clients')

  const status = ['active', 'archived', 'all'].includes(searchParams.status ?? '') ? searchParams.status! : 'active'
  const q = (searchParams.q ?? '').trim()

  const where: Prisma.ClientWhereInput = {
    accountId,
    ...(status === 'active' ? { isActive: true } : status === 'archived' ? { isActive: false } : {}),
    ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
  }

  const [clients, activeCount, entities, projAgg, arRows] = await Promise.all([
    prisma.client.findMany({
      where,
      select: { id: true, name: true, currency: true, isActive: true, entity: { select: { code: true, name: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.client.count({ where: { accountId, isActive: true } }),
    listEntities(accountId),
    prisma.project.groupBy({ by: ['clientId'], where: { accountId }, _count: { _all: true } }),
    prisma.$queryRaw<{ clientId: string; open: bigint; overdue: bigint }[]>`
      SELECT "clientId",
        COALESCE(SUM("totalCents" - "paidCents"),0)::bigint AS open,
        COALESCE(SUM(CASE WHEN "dueDate" < NOW() THEN "totalCents" - "paidCents" ELSE 0 END),0)::bigint AS overdue
      FROM "Invoice" WHERE "accountId" = ${accountId} AND status::text = 'open' GROUP BY "clientId"`,
  ])

  const projBy = new Map(projAgg.map((r) => [r.clientId, r._count._all]))
  const arBy = new Map(arRows.map((r) => [r.clientId, { open: Number(r.open), overdue: Number(r.overdue) }]))
  const totalOutstanding = arRows.reduce((s, r) => s + Number(r.open), 0)

  const qp = (over: Record<string, string>) => {
    const p = new URLSearchParams({ ...(status !== 'active' ? { status } : {}), ...(q ? { q } : {}), ...over })
    const s = p.toString()
    return s ? `/clients?${s}` : '/clients'
  }
  const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <span className="text-sm text-gray-500">Total outstanding <span className="font-semibold text-gray-800">{formatCents(totalOutstanding)}</span></span>
      </div>

      {canManage && <NewClientForm entities={entities.map((e) => ({ id: e.id, name: e.name, code: e.code }))} />}

      {/* Filters */}
      <form className="mb-4 flex flex-wrap items-center gap-2">
        <select name="status" defaultValue={status} className={input}>
          <option value="active">Active clients ({activeCount})</option>
          <option value="archived">Archived clients</option>
          <option value="all">All clients</option>
        </select>
        <input name="q" defaultValue={q} placeholder="Search clients" className={`${input} w-56`} />
        <button className="rounded bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">Apply</button>
        {(q || status !== 'active') && <Link href="/clients" className="text-sm text-gray-400 hover:text-gray-600">Clear</Link>}
        <span className="ml-auto text-sm text-gray-400">{clients.length} shown</span>
      </form>

      <div className="overflow-visible rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 text-right font-medium">Projects</th>
              <th className="px-4 py-3 text-right font-medium">Outstanding</th>
              <th className="px-4 py-3 text-right font-medium">Overdue</th>
              {canManage && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => {
              const ar = arBy.get(c.id) ?? { open: 0, overdue: 0 }
              return (
                <ClickableRow key={c.id} href={`/clients/${c.id}`} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/clients/${c.id}`} className="font-medium text-gray-900 hover:text-brand-teal">{c.name}</Link>
                    {c.entity && <span className="ml-2"><EntityChip code={c.entity.code} name={c.entity.name} /></span>}
                    {!c.isActive && <span className="ml-2 text-xs text-gray-400">(archived)</span>}
                    <span className="ml-2 text-xs text-gray-400">{c.currency}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-600">{projBy.get(c.id) ?? 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{ar.open > 0 ? formatCents(ar.open, c.currency) : '—'}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${ar.overdue > 0 ? 'font-medium text-red-600' : 'text-gray-400'}`}>{ar.overdue > 0 ? formatCents(ar.overdue, c.currency) : '—'}</td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <details className="relative inline-block text-left">
                        <summary className="cursor-pointer list-none rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">Actions ▾</summary>
                        <div className="absolute right-0 z-10 mt-1 w-36 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-left shadow-lg">
                          <Link href={`/clients/${c.id}`} className="block px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">View</Link>
                          <Link href={`/clients/${c.id}/edit`} className="block px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">Edit</Link>
                          <form action={setClientArchivedAction}>
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="archived" value={c.isActive ? 'on' : 'off'} />
                            <button className="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50">{c.isActive ? 'Archive' : 'Restore'}</button>
                          </form>
                        </div>
                      </details>
                    </td>
                  )}
                </ClickableRow>
              )
            })}
            {clients.length === 0 && (
              <tr><td colSpan={canManage ? 5 : 4} className="px-4 py-8 text-center text-gray-400">No clients match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-400">Outstanding = open invoice balances; Overdue = past due. Contacts live on each client&apos;s page.</p>
    </div>
  )
}
