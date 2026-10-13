import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { EXPORT_TABLES, type ExportTableKey } from '@/modules/export/fullExport'

export const dynamic = 'force-dynamic'

/** Settings → Data export: a full copy of the account's data, one CSV per table (admins only). */
export default async function DataExportPage() {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'edit_account_settings')) redirect('/')

  const w = { where: { accountId } }
  const [timeEntries, invoices, lineItems, payments, clients, contacts, projects, people, expenses] = await Promise.all([
    prisma.timeEntry.count(w), prisma.invoice.count(w), prisma.invoiceLineItem.count(w), prisma.payment.count(w),
    prisma.client.count(w), prisma.clientContact.count(w), prisma.project.count(w), prisma.user.count(w), prisma.expense.count(w),
  ])
  const counts: Record<ExportTableKey, number> = {
    'time-entries': timeEntries, invoices, 'invoice-line-items': lineItems, payments, clients, contacts, projects, people, expenses,
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-3">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-brand-teal">Settings</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-semibold">Data export</h1>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        Download a complete copy of this account&apos;s data, one CSV file per table, with every column (ids included) so the
        files can be joined back together. Password hashes and access tokens are left out. Large tables stream, so the time
        entries file can take a minute or two to finish.
      </p>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2 font-medium">Table</th>
              <th className="px-4 py-2 text-right font-medium">Rows</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {(Object.keys(EXPORT_TABLES) as ExportTableKey[]).map((key) => (
              <tr key={key} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-2 text-gray-700">{EXPORT_TABLES[key].label}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-500">{counts[key].toLocaleString('en-US')}</td>
                <td className="px-4 py-2 text-right">
                  <a
                    href={`/settings/export/${key}`}
                    download
                    className="rounded border border-brand-teal px-3 py-1 text-xs font-medium text-brand-teal hover:bg-teal-50"
                  >
                    Download CSV
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-400">
        This is a convenience copy. The nightly database backup (see OPS.md) is the restorable backup of record.
      </p>
    </div>
  )
}
