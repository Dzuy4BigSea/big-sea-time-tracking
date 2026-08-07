import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { isEncryptionConfigured } from '@/lib/crypto'
import { getConnectionViewsDetailed, type DetailedConnectionView } from '@/lib/integrations'
import { listEntities } from '@/lib/entities'
import { PROVIDERS } from '@/lib/integration-registry'
import { IntegrationForm, type ConnectionViewProps } from '@/components/IntegrationForm'
import { importAsanaAction } from '@/app/settings/integrations/actions'
import { formatDate } from '@/lib/format'

export const dynamic = 'force-dynamic'

// Providers that connect PER business entity (own Stripe account / Xero org). Others are shared.
const ENTITY_SCOPED = new Set(['stripe', 'xero'])

const EMPTY_VIEW: ConnectionViewProps = {
  status: 'disconnected',
  connected: false,
  externalOrgName: null,
  lastSyncedAt: null,
  config: {},
  secretsSet: [],
}
const toViewProps = (v: DetailedConnectionView | undefined): ConnectionViewProps =>
  v
    ? { status: v.status, connected: v.connected, externalOrgName: v.externalOrgName, lastSyncedAt: v.lastSyncedAt ? v.lastSyncedAt.toISOString() : null, config: v.config, secretsSet: v.secretsSet }
    : EMPTY_VIEW

export default async function IntegrationsSettingsPage() {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'edit_account_settings')) {
    redirect('/')
  }

  const [detailed, entities, recentLogs] = await Promise.all([
    getConnectionViewsDetailed(accountId),
    listEntities(accountId),
    prisma.integrationSyncLog.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 15 }),
  ])
  const encOk = isEncryptionConfigured()
  // Lookup by `${provider}:${entityId ?? ''}`.
  const byKey = new Map(detailed.map((v) => [`${v.provider}:${v.entityId ?? ''}`, v]))
  const h = headers()
  const base = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host') ?? ''}`
  const stripeWebhookUrl = `${base}/api/integrations/stripe/webhook/${accountId}`

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-3">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-brand-teal">
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

      <div className="space-y-5">
        {PROVIDERS.map((def) => {
          if (!ENTITY_SCOPED.has(def.key)) {
            // Shared, account-wide connection (Asana, Harvest, …).
            return (
              <IntegrationForm
                key={def.key}
                def={def}
                view={toViewProps(byKey.get(`${def.key}:`))}
                extra={
                  def.key === 'asana' ? (
                    <form action={importAsanaAction} className="flex items-center gap-3">
                      <button className="rounded border border-brand-green px-4 py-1.5 text-sm font-medium text-brand-green hover:bg-green-50">
                        Import projects &amp; people
                      </button>
                      <span className="text-xs text-gray-400">Idempotent — safe to re-run. Shared across all companies.</span>
                    </form>
                  ) : undefined
                }
              />
            )
          }
          // Entity-scoped: one connection per business entity (own Stripe account / Xero org).
          return (
            <div key={def.key}>
              <div className="mb-1.5 flex items-baseline gap-2">
                <h2 className="text-sm font-semibold text-gray-800">{def.name}</h2>
                <span className="text-xs text-gray-400">one per company</span>
              </div>
              <div className="space-y-2">
                {entities.map((ent) => (
                  <IntegrationForm
                    key={`${def.key}:${ent.id}`}
                    def={def}
                    entityId={ent.id}
                    entityLabel={ent.name}
                    view={toViewProps(byKey.get(`${def.key}:${ent.id}`))}
                    hint={
                      def.key === 'stripe' ? (
                        <span>
                          In this company&apos;s Stripe dashboard, add a webhook endpoint pointing to{' '}
                          <code className="break-all">{stripeWebhookUrl}</code> and paste its signing secret above.
                        </span>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            </div>
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
