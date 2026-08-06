import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { isEncryptionConfigured } from '@/lib/crypto'
import { getConnectionViews } from '@/lib/integrations'
import { PROVIDERS } from '@/lib/integration-registry'
import { IntegrationForm } from '@/components/IntegrationForm'
import { formatDate } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function IntegrationsSettingsPage() {
  const { accountId, permissionProfile } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile }, 'edit_account_settings')) {
    redirect('/')
  }

  const [views, recentLogs] = await Promise.all([
    getConnectionViews(accountId),
    prisma.integrationSyncLog.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 15 }),
  ])
  const encOk = isEncryptionConfigured()

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-3">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-brand-orange">
          Settings
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-semibold">Integrations</h1>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        Connect Track2 to the tools you use. Credentials are encrypted at rest and never shown again after saving.
      </p>

      {!encOk && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <span className="font-medium">Set the <code>INTEGRATION_ENC_KEY</code> environment variable</span> (min 16 chars)
          before saving any credentials — it encrypts them at rest. Add it in your Vercel project env (and local
          <code> .env</code>), then redeploy.
        </div>
      )}

      <div className="space-y-3">
        {PROVIDERS.map((def) => {
          const v = views[def.key]
          return (
            <IntegrationForm
              key={def.key}
              def={def}
              view={{
                status: v.status,
                connected: v.connected,
                externalOrgName: v.externalOrgName,
                lastSyncedAt: v.lastSyncedAt ? v.lastSyncedAt.toISOString() : null,
                config: v.config,
                secretsSet: v.secretsSet,
              }}
            />
          )
        })}
      </div>

      <h2 className="mb-2 mt-8 text-sm font-semibold text-gray-700">Recent sync activity</h2>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Provider</th>
              <th className="px-4 py-2 font-medium">Direction</th>
              <th className="px-4 py-2 font-medium">Entity</th>
              <th className="px-4 py-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {recentLogs.map((l) => (
              <tr key={l.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-2 text-gray-500">{formatDate(l.createdAt)}</td>
                <td className="px-4 py-2 capitalize text-gray-700">{l.provider}</td>
                <td className="px-4 py-2 text-gray-500">{l.direction}</td>
                <td className="px-4 py-2 text-gray-600">
                  {l.entityType}
                  {l.message ? <span className="text-gray-400"> — {l.message}</span> : ''}
                </td>
                <td className="px-4 py-2">
                  {l.ok ? (
                    <span className="text-brand-green">ok</span>
                  ) : (
                    <span className="text-red-600">failed</span>
                  )}
                </td>
              </tr>
            ))}
            {recentLogs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  No sync activity yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
