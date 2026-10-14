'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { runChecksNowAction, type RunChecksState } from '@/app/settings/activity-log/actions'

const LEVEL: Record<string, string> = {
  info: 'bg-green-100 text-green-700',
  warn: 'bg-amber-100 text-amber-800',
  error: 'bg-red-100 text-red-700',
}
const LEVEL_LABEL: Record<string, string> = { info: 'OK', warn: 'Warning', error: 'Error' }

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
      {pending ? 'Running checks…' : 'Run checks now'}
    </button>
  )
}

/** Settings → Activity log: run the provider + trace checks on demand and show the results inline. */
export function RunHealthChecks() {
  const [state, action] = useFormState<RunChecksState, FormData>(runChecksNowAction, {})
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4" data-testid="health-checks">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <Submit />
        <span className="text-xs text-gray-500">
          Read-only checks of SendGrid, Stripe and Xero, plus our own trace. They also run daily; errors email the admins (once a day per problem).
        </span>
      </form>
      {state.error && <p className="mt-3 text-sm text-red-600">{state.error}</p>}
      {state.results && (
        <div className="mt-3">
          {!state.results.length ? (
            <p className="text-sm text-gray-500">No integrations are connected, so there was nothing to check.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {state.results.map((r, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    <td className="py-1.5 pr-3 align-top">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL[r.level] ?? LEVEL.info}`}>{LEVEL_LABEL[r.level] ?? r.level}</span>
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-3 align-top font-mono text-xs text-gray-500">
                      {r.check}
                      {r.entity ? ` · ${r.entity}` : ''}
                    </td>
                    <td className="py-1.5 align-top text-gray-700">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
