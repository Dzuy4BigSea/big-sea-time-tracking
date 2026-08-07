import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { isEncryptionConfigured } from '@/lib/crypto'
import { getConnectionViewsDetailed, type DetailedConnectionView } from '@/lib/integrations'
import { PROVIDERS } from '@/lib/integration-registry'
import { IntegrationForm, type ConnectionViewProps } from '@/components/IntegrationForm'
import { BrandConsoleForm } from '@/components/BrandConsoleForm'
import { importAsanaAction } from '@/app/settings/integrations/actions'
import { addEntityAction, setDefaultEntityAction, setEntityActiveAction } from '@/app/settings/entities/actions'
import { formatDate } from '@/lib/format'

export const dynamic = 'force-dynamic'

// Providers that connect PER business entity (own Stripe account / Xero org). Others are shared.
const ENTITY_SCOPED = new Set(['stripe', 'xero'])

const EMPTY_VIEW: ConnectionViewProps = { status: 'disconnected', connected: false, externalOrgName: null, lastSyncedAt: null, config: {}, secretsSet: [] }
const toViewProps = (v: DetailedConnectionView | undefined): ConnectionViewProps =>
  v
    ? { status: v.status, connected: v.connected, externalOrgName: v.externalOrgName, lastSyncedAt: v.lastSyncedAt ? v.lastSyncedAt.toISOString() : null, config: v.config, secretsSet: v.secretsSet }
    : EMPTY_VIEW

export default async function IntegrationsSettingsPage({ searchParams }: { searchParams: { company?: string } }) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'edit_account_settings')) {
    redirect('/')
  }

  const [detailed, entities, recentLogs] = await Promise.all([
    getConnectionViewsDetailed(accountId),
    prisma.businessEntity.findMany({ where: { accountId }, orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.integrationSyncLog.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 15 }),
  ])
  const encOk = isEncryptionConfigured()
  const byKey = new Map(detailed.map((v) => [`${v.provider}:${v.entityId ?? ''}`, v]))
  const h = headers()
  const base = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host') ?? ''}`
  const stripeWebhookUrl = `${base}/api/integrations/stripe/webhook/${accountId}`

  const selected = entities.find((e) => e.id === searchParams.company) ?? entities.find((e) => e.isDefault) ?? entities[0]
  const sharedProviders = PROVIDERS.filter((d) => !ENTITY_SCOPED.has(d.key))
  const entityProviders = PROVIDERS.filter((d) => ENTITY_SCOPED.has(d.key))

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-3">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-brand-teal">Settings</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-semibold">Integrations &amp; brand</h1>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        Pick a company to set its branding, sender identity, and its own Stripe / Xero. Credentials are
        encrypted at rest and never shown again after saving.
      </p>

      {!encOk && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <span className="font-medium">Set the <code>INTEGRATION_ENC_KEY</code> environment variable</span> (min 16 chars)
          before saving any credentials — it encrypts them at rest.
        </div>
      )}

      {/* Company tab bar */}
      <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-gray-200 pb-3">
        {entities.map((e) => (
          <Link
            key={e.id}
            href={`/settings/integrations?company=${e.id}`}
            className={`rounded-full px-3 py-1.5 text-sm ${
              e.id === selected?.id ? 'bg-brand-teal text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {e.name}
            <span className={`ml-1.5 text-xs ${e.id === selected?.id ? 'text-white/70' : 'text-gray-400'}`}>{e.code}</span>
            {e.isDefault && <span className={`ml-1.5 text-[10px] uppercase ${e.id === selected?.id ? 'text-white/70' : 'text-gray-400'}`}>· default</span>}
            {!e.isActive && <span className="ml-1.5 text-[10px] uppercase text-amber-500">· inactive</span>}
          </Link>
        ))}
        <form action={addEntityAction} className="flex items-center gap-1">
          <input name="name" placeholder="New company" className="w-32 rounded border border-gray-300 px-2 py-1 text-sm" />
          <input name="code" placeholder="Code" className="w-16 rounded border border-gray-300 px-2 py-1 text-sm" />
          <button className="rounded border border-brand-green px-2 py-1 text-sm font-medium text-brand-green hover:bg-green-50">+ Add</button>
        </form>
      </div>

      {selected && (
        <div className="space-y-8">
          {/* Company profile & branding */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">{selected.name} — branding &amp; identity</h2>
              <div className="flex items-center gap-3 text-sm">
                {!selected.isDefault && (
                  <form action={setDefaultEntityAction}>
                    <input type="hidden" name="id" value={selected.id} />
                    <button className="text-brand-teal hover:underline">Set as default</button>
                  </form>
                )}
                {!selected.isDefault && (
                  <form action={setEntityActiveAction}>
                    <input type="hidden" name="id" value={selected.id} />
                    <input type="hidden" name="active" value={selected.isActive ? '0' : '1'} />
                    <button className={selected.isActive ? 'text-red-600 hover:underline' : 'text-brand-green hover:underline'}>
                      {selected.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </form>
                )}
              </div>
            </div>
            <BrandConsoleForm entity={selected} />
            <p className="mt-3 text-sm text-gray-500">
              Tailor this company&apos;s invoice language and email wording under{' '}
              <Link href={`/invoices/configure?company=${selected.id}`} className="text-brand-teal hover:underline">Invoices → Configure</Link>.
            </p>
          </section>

          {/* Per-company payments & accounting */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-gray-800">Payments &amp; accounting for {selected.name}</h2>
            <div className="space-y-2">
              {entityProviders.map((def) => (
                <IntegrationForm
                  key={`${def.key}:${selected.id}`}
                  def={def}
                  entityId={selected.id}
                  entityLabel={selected.code}
                  view={toViewProps(byKey.get(`${def.key}:${selected.id}`))}
                  hint={
                    def.key === 'stripe' ? (
                      <span>
                        In {selected.name}&apos;s Stripe dashboard, add a webhook endpoint pointing to{' '}
                        <code className="break-all">{stripeWebhookUrl}</code> and paste its signing secret above.
                      </span>
                    ) : undefined
                  }
                />
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Shared across all companies */}
      <section className="mt-10">
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-gray-800">Shared across all companies</h2>
          <span className="text-xs text-gray-400">one connection for the whole workspace</span>
        </div>
        <div className="space-y-2">
          {sharedProviders.map((def) => (
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
              hint={
                def.key === 'sendgrid' ? (
                  <span>One SendGrid key sends for every company; each company&apos;s from-name / from-email comes from its branding above.</span>
                ) : undefined
              }
            />
          ))}
        </div>
      </section>

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
                <td className="px-4 py-2">{l.ok ? <span className="text-brand-green">ok</span> : <span className="text-red-600">failed</span>}</td>
              </tr>
            ))}
            {recentLogs.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No sync activity yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
