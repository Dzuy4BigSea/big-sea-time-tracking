import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { isEncryptionConfigured } from '@/lib/crypto'
import { getConnectionWithSecrets } from '@/lib/integrations'
import { HarvestCredsForm } from '@/components/HarvestCredsForm'
import { BackupRunner } from '@/components/BackupRunner'
import { formatDate } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // allow long pulls; partial-failure handling covers plan caps

export default async function MigratePage() {
  const { accountId, permissionProfile } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile }, 'edit_account_settings')) redirect('/')

  const [conn, snapshots] = await Promise.all([
    getConnectionWithSecrets(accountId, 'harvest'),
    prisma.migrationSnapshot.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { parts: { select: { id: true, resource: true, chunk: true, rowCount: true }, orderBy: [{ resource: 'asc' }, { chunk: 'asc' }] } },
    }),
  ])
  const connected = conn?.status === 'connected'
  const encOk = isEncryptionConfigured()
  const lastPulledAt = (conn?.config.lastPulledAt as string | undefined) ?? null
  const hasCompleteBackup = snapshots.some((s) => s.status === 'complete')
  const runningSnap = snapshots.find((s) => s.status === 'running') ?? null
  const running = runningSnap
    ? {
        id: runningSnap.id,
        done: runningSnap.parts.length,
        total: Number((runningSnap.meta as { total?: number } | null)?.total ?? 0),
        rows: Object.values((runningSnap.entityCounts as Record<string, number> | null) ?? {}).reduce((a, b) => a + b, 0),
      }
    : null

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-3">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-brand-teal">Settings</Link>
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
      <div className="mb-1">
        <BackupRunner connected={connected} hasCompleteBackup={hasCompleteBackup} running={running} />
      </div>
      <p className="mb-4 text-xs text-gray-400">
        {lastPulledAt ? `Last clean pull: ${new Date(lastPulledAt).toLocaleString()}` : 'No clean pull yet — start with a full backup.'}
      </p>

      <div className="mb-8 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2 font-medium">Captured</th>
              <th className="px-4 py-2 font-medium">Mode</th>
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
                <tr key={s.id} className="border-b border-gray-100 align-top last:border-0">
                  <td className="px-4 py-2 text-gray-600">{formatDate(s.createdAt)}</td>
                  <td className="px-4 py-2 capitalize text-gray-500">{s.mode}</td>
                  <td className="px-4 py-2">
                    {s.status === 'complete' ? (
                      <span className="text-brand-green">complete</span>
                    ) : s.status === 'partial' ? (
                      <span className="text-amber-600" title={s.errorMessage ?? ''}>partial</span>
                    ) : s.status === 'running' ? (
                      <span className="text-gray-400">running…</span>
                    ) : (
                      <span className="text-red-600" title={s.errorMessage ?? ''}>error</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {total.toLocaleString()} rows · {s.parts.length} parts
                  </td>
                  <td className="px-4 py-2 text-right">
                    {s.parts.length > 0 && (
                      <details className="text-left">
                        <summary className="cursor-pointer text-xs text-blue-600 hover:underline">
                          Download ({s.parts.length})
                        </summary>
                        <div className="mt-2 space-y-1">
                          <a href={`/settings/migrate/snapshot/${s.id}`} className="block text-xs text-gray-600 hover:text-brand-teal">
                            ⤓ Manifest (checksums)
                          </a>
                          {s.parts.map((p) => (
                            <a
                              key={p.id}
                              href={`/settings/migrate/snapshot/${s.id}/part/${p.id}`}
                              className="block text-xs text-gray-600 hover:text-brand-teal"
                            >
                              ⤓ {p.resource}
                              {p.chunk ? ` ${p.chunk}` : ''} ({p.rowCount.toLocaleString()})
                            </a>
                          ))}
                        </div>
                      </details>
                    )}
                  </td>
                </tr>
              )
            })}
            {snapshots.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">No backups yet.</td>
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
