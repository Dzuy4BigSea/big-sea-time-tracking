'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { saveHarvestCredsAction, type MigrateState } from '@/app/settings/migrate/actions'

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

function Save() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Verifying…' : 'Save & verify'}
    </button>
  )
}

export function HarvestCredsForm({ connected, orgName, accountId }: { connected: boolean; orgName: string | null; accountId: string }) {
  const [state, formAction] = useFormState<MigrateState, FormData>(saveHarvestCredsAction, {})

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-gray-800">Harvest connection</span>
        {connected ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            Connected{orgName ? ` · ${orgName}` : ''}
          </span>
        ) : (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">Not connected</span>
        )}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-700">Personal access token{connected && <span className="ml-2 text-xs text-brand-green">•••• stored</span>}</span>
        <input
          type="password"
          name="accessToken"
          autoComplete="off"
          placeholder={connected ? 'Leave blank to keep current' : 'Harvest personal access token'}
          className={`${input} w-full max-w-md font-mono`}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-700">Harvest Account ID</span>
        <input name="harvestAccountId" defaultValue={accountId} placeholder="e.g. 1234567" className={`${input} w-48`} />
      </label>

      <div className="flex items-center gap-3">
        <Save />
        <a href="https://id.getharvest.com/developers" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
          Create a token ↗
        </a>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-brand-green">Connected ✓</span>}
      </div>
    </form>
  )
}
