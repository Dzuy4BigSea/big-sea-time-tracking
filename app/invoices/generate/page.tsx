import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireCapability } from '@/lib/session'
import { requireModule } from '@/lib/modules'
import { formatCents } from '@/lib/format'
import { fixedFeeStatus } from '@/modules/invoicing/fixedFee'
import { generateInvoiceAction } from '@/app/invoices/actions'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<string, string> = { time_and_materials: 'Time & Materials', fixed_fee: 'Fixed Fee', non_billable: 'Non-Billable' }
const hours = (min: number) => (min / 60).toFixed(2)

/**
 * "Create an invoice for tracked time, expenses, or fixed fees" (Harvest): pick the client's projects
 * to invoice. Time & Materials projects bill their uninvoiced time; Fixed Fee projects bill ONE line
 * for the remaining uninvoiced fee (their hours stay uninvoiced hours); billable expenses are added.
 */
export default async function GenerateInvoicePage({ searchParams }: { searchParams: { clientId?: string; error?: string } }) {
  const { accountId } = await requireCapability('manage_invoices')
  await requireModule(accountId, 'invoices')
  const clientId = searchParams.clientId ?? ''
  const client = await prisma.client.findFirst({ where: { id: clientId, accountId }, select: { id: true, name: true, currency: true } })
  if (!client) notFound()

  // Aggregated in the DB (uninvoiced-pool predicate, modules/invoicing/uninvoiced.ts), one row per project.
  const [projects, timeRows, expenseRows, fixedFees] = await Promise.all([
    prisma.project.findMany({
      where: { accountId, clientId: client.id },
      select: { id: true, name: true, code: true, projectType: true, isActive: true, archivedAt: true },
      orderBy: { name: 'asc' },
    }),
    prisma.$queryRaw<{ projectId: string; mins: number; cents: number }[]>`
      SELECT te."projectId", COALESCE(SUM(te.minutes),0)::int AS mins,
        COALESCE(SUM(FLOOR(te.minutes::float8 / 60 * COALESCE(te."billableRateCents",0) + 0.5)),0)::float8 AS cents
      FROM "TimeEntry" te JOIN "Project" p ON p.id = te."projectId"
      WHERE te."accountId" = ${accountId} AND p."clientId" = ${client.id} AND te."isBillable" AND NOT te."isRunning"
        AND te."invoiceLineItemId" IS NULL AND te."lockState"::text <> 'invoiced'
      GROUP BY te."projectId"`,
    prisma.$queryRaw<{ projectId: string; cents: number }[]>`
      SELECT x."projectId", COALESCE(SUM(FLOOR(x."totalCents" * (1 + COALESCE(x."markupPercent", 0)::float8 / 100) + 0.5)),0)::float8 AS cents
      FROM "Expense" x JOIN "Project" p ON p.id = x."projectId"
      WHERE x."accountId" = ${accountId} AND p."clientId" = ${client.id} AND x."isBillable"
        AND x."invoiceLineItemId" IS NULL AND x."lockState"::text <> 'invoiced'
      GROUP BY x."projectId"`,
    fixedFeeStatus(prisma, accountId, { clientId: client.id }),
  ])
  const time = new Map(timeRows.map((r) => [r.projectId, r]))
  const exp = new Map(expenseRows.map((r) => [r.projectId, Number(r.cents)]))
  const ff = new Map(fixedFees.map((f) => [f.projectId, f]))
  const cur = client.currency

  const rows = projects
    .map((p) => {
      const t = time.get(p.id)
      const mins = Number(t?.mins ?? 0)
      const expenseCents = exp.get(p.id) ?? 0
      const fee = ff.get(p.id)
      const isFixed = p.projectType === 'fixed_fee'
      const amountCents = isFixed ? fee?.remainingCents ?? 0 : p.projectType === 'time_and_materials' ? Math.round(Number(t?.cents ?? 0)) : 0
      const active = p.isActive && !p.archivedAt
      const hasSomething = amountCents > 0 || expenseCents > 0 || (!isFixed && p.projectType === 'time_and_materials' && mins > 0)
      return { ...p, mins, expenseCents, fee, isFixed, amountCents, active, hasSomething }
    })
    // Active projects, plus archived ones that still have something to invoice.
    .filter((r) => r.active || r.hasSomething)

  return (
    <div className="max-w-4xl">
      <Link href="/invoices" className="text-sm text-gray-500 hover:text-brand-teal">← Back to invoices</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold">New invoice for {client.name}</h1>
      <p className="mb-4 text-sm text-gray-500">
        Create an invoice for tracked time, expenses, or fixed fees. Fixed Fee projects add one line for the remaining
        uninvoiced fee; their hours stay uninvoiced.
      </p>
      {searchParams.error && (
        <div role="alert" className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{searchParams.error}</div>
      )}

      <form action={generateInvoiceAction}>
        <input type="hidden" name="clientId" value={client.id} />
        <input type="hidden" name="pickProjects" value="1" />
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="w-8 px-3 py-2" />
                <th className="px-3 py-2 font-medium">Project</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 text-right font-medium">Uninvoiced hours</th>
                <th className="px-3 py-2 text-right font-medium">Uninvoiced amount</th>
                <th className="px-3 py-2 text-right font-medium">Expenses</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-2">
                    <input type="checkbox" name="projectId" value={r.id} defaultChecked={r.hasSomething} aria-label={`Invoice ${r.name}`} className="h-4 w-4" />
                  </td>
                  <td className="px-3 py-2">
                    {r.code && <span className="mr-1 text-gray-400">[{r.code}]</span>}
                    {r.name}
                    {!r.active && <span className="ml-2 text-xs text-gray-400">(archived)</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{TYPE_LABEL[r.projectType] ?? r.projectType}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.mins ? hours(r.mins) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.isFixed ? (
                      r.fee?.feeCents != null ? (
                        <span title={`Project fee ${formatCents(r.fee.feeCents, cur)} · invoiced ${formatCents(r.fee.invoicedCents, cur)}`}>
                          {formatCents(r.amountCents, cur)}
                          <span className="block text-xs text-gray-400">remaining of {formatCents(r.fee.feeCents, cur)} fee</span>
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">No project fee set</span>
                      )
                    ) : r.projectType === 'non_billable' ? '—' : (
                      formatCents(r.amountCents, cur)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.expenseCents ? formatCents(r.expenseCents, cur) : '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400">This client has no active projects.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90">Create invoice</button>
          <Link href="/invoices" className="text-sm text-gray-500 hover:text-gray-800">Cancel</Link>
        </div>
      </form>
    </div>
  )
}
