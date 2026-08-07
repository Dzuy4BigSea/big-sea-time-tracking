'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { saveIntegrationAction, disconnectIntegrationAction, type IntegrationState } from '@/app/settings/integrations/actions'
import type { ProviderDef } from '@/lib/integration-registry'

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

function Save() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Save'}
    </button>
  )
}

export interface ConnectionViewProps {
  status: string
  connected: boolean
  externalOrgName: string | null
  lastSyncedAt: string | null
  config: Record<string, unknown>
  secretsSet: string[]
}

export function IntegrationForm({
  def,
  view,
  extra,
  entityId,
  entityLabel,
  hint,
}: {
  def: ProviderDef
  view: ConnectionViewProps
  extra?: React.ReactNode
  /** When set, this form connects the provider for a specific business entity (specs/16). */
  entityId?: string
  entityLabel?: string
  /** Optional note under the header (e.g. the per-entity Stripe webhook URL). */
  hint?: React.ReactNode
}) {
  const [state, formAction] = useFormState<IntegrationState, FormData>(saveIntegrationAction, {})

  return (
    <details className="rounded-lg border border-gray-200 bg-white" open={!view.connected}>
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3">
        <span className="flex items-center gap-3">
          <span className="font-medium text-gray-900">{def.name}</span>
          {entityLabel && (
            <span className="rounded bg-brand-teal-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-teal">
              {entityLabel}
            </span>
          )}
          <span className="text-xs text-gray-400">{def.category}</span>
          {view.connected ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              Connected{view.externalOrgName ? ` · ${view.externalOrgName}` : ''}
            </span>
          ) : (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">Not connected</span>
          )}
        </span>
        <span className="text-xs text-brand-green">Setup ▾</span>
      </summary>

      <div className="border-t border-gray-100 p-4">
        <p className="mb-3 text-sm text-gray-500">{def.description}</p>
        {hint && <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 p-2.5 text-xs text-gray-600">{hint}</div>}
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="provider" value={def.key} />
          {entityId && <input type="hidden" name="entityId" value={entityId} />}

          {def.secrets.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Credentials</div>
              {def.secrets.map((f) => {
                const isSet = view.secretsSet.includes(f.key)
                return (
                  <label key={f.key} className="flex flex-col gap-1">
                    <span className="text-sm text-gray-700">
                      {f.label}
                      {f.required && <span className="text-red-500"> *</span>}
                      {isSet && <span className="ml-2 text-xs text-brand-green">•••• stored</span>}
                    </span>
                    <input
                      type="password"
                      name={`secret_${f.key}`}
                      placeholder={isSet ? 'Leave blank to keep current' : f.placeholder}
                      autoComplete="off"
                      className={`${input} w-full max-w-md font-mono`}
                    />
                    {f.help && <span className="text-xs text-gray-400">{f.help}</span>}
                  </label>
                )
              })}
            </div>
          )}

          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Configuration</div>
            {def.config.map((f) =>
              f.kind === 'toggle' ? (
                <label key={f.key} className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" name={`config_${f.key}`} defaultChecked={!!view.config[f.key]} className="h-4 w-4" />
                  {f.label}
                </label>
              ) : (
                <label key={f.key} className="flex flex-col gap-1">
                  <span className="text-sm text-gray-700">
                    {f.label}
                    {f.required && <span className="text-red-500"> *</span>}
                  </span>
                  <input
                    name={`config_${f.key}`}
                    defaultValue={String(view.config[f.key] ?? '')}
                    placeholder={f.placeholder}
                    className={`${input} w-full max-w-md`}
                  />
                  {f.help && <span className="text-xs text-gray-400">{f.help}</span>}
                </label>
              ),
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Save />
            {view.connected && (
              <button
                type="submit"
                formAction={disconnectIntegrationAction}
                className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600"
              >
                Disconnect
              </button>
            )}
            <a href={def.docsUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
              Where do I find these? ↗
            </a>
            {state.error && <span className="text-sm text-red-600">{state.error}</span>}
            {state.ok && <span className="text-sm text-brand-green">Saved ✓</span>}
          </div>
        </form>
        {view.connected && extra && <div className="mt-3 border-t border-gray-100 pt-3">{extra}</div>}
      </div>
    </details>
  )
}
