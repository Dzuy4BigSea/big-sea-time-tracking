import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { isEncryptionConfigured } from '@/lib/crypto'
import { getConnectionWithSecrets } from '@/lib/integrations'
import { HarvestCredsForm } from '@/components/HarvestCredsForm'
import { createBackupSnapshotAction } from '@/app/settings/migrate/actions'
import { formatDate } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function MigratePage() {
  const { accountId, permissionProfile } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile }, 'edit_account_settings')) redirect('/')

  const [conn, snapshots] = await Promise.all([
    getConnectionWithSecrets(accountId, 'harvest'),
    prisma.migrationSnapshot.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ])
  const connected = conn?.status === 'connected'
  const encOk = isEncryptionConfigured()

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-3">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-brand-orange">Settings</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-semibold">Migrate from Harvest</h1>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        Connect your Harvest account (read-only token), capture a full raw <strong>backup</strong> of your data, then
        import it. The backup is taken <strong>before</strong> any transformation, so you always keep an untouched copy.
      </p>

      {!encOk && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          Set the <code>INTEGRATION_ENC_KEY</code> environment variable before storing the Harvest token.
        </div>
      )}

      {/* Step 1 — connect */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">1 · Connect</h2>
      <div className="mb-8">
        <HarvestCredsForm connected={connected} orgName={conn?.externalOrgName ?? null} accountId={String(conn?.config.harvestAccountId ?? '')} />
      </div>

      {/* Step 2 — backup */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">2 · Backup (before ETL)</h2>
      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-5">
        <p className="mb-3 text-sm text-gray-600">
          Pulls every Harvest record (clients, contacts, projects, tasks, people, time, expenses, invoices, estimates)
          and stores an immutable JSON snapshot you can download and keep. Run this first — it does not change anything.
        </p>
        <form action={createBackupSnapshotAction}>
          <button
            disabled={!connected}
            className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create backup snapshot
          </button>
          {!connected && <span className="ml-3 text-xs text-gray-400">Connect Harvest first.</span>}
        </form>
      </div>

      <div className="mb-8 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2 font-medium">Captured</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Records</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {snapshots.map((s) => {
              const counts = (s.entityCounts as Record<string, number> | null) ?? {}
              const total = Object.values(counts).reduce((a, b) => a + b, 0)
              return (
                <tr key={s.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-2 text-gray-600">{formatDate(s.createdAt)}</td>
                  <td className="px-4 py-2">
                    {s.status === 'complete' ? (
                      <span className="text-brand-green">complete</span>
                    ) : (
                      <span className="text-red-600" title={s.errorMessage ?? ''}>error</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {s.status === 'complete' ? `${total.toLocaleString()} across ${Object.keys(counts).length} types` : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {s.status === 'complete' && (
                      <a href={`/settings/migrate/snapshot/${s.id}`} className="text-xs text-blue-600 hover:underline">
                        Download JSON
                      </a>
                    )}
                  </td>
                </tr>
              )
            })}
            {snapshots.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">No backups yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Step 3 — import (ETL) */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">3 · Import into Track2</h2>
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-500">
        Dry-run preview + apply (idempotent) — coming next. The importer transforms a backup snapshot into Track2
        clients, projects, tasks, people, assignments, time, and invoices, keyed by Harvest IDs so it is safe to re-run.
      </div>
    </div>
  )
}
