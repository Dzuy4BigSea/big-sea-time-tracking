'use client'

import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { createApiTokenAction, type CreateTokenState } from '@/app/settings/tokens/actions'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Creating…' : 'Create token'}
    </button>
  )
}

/** Create a personal access token; the new token is shown once, with a copy button. */
export function ApiTokenCreateForm() {
  const [state, formAction] = useFormState<CreateTokenState, FormData>(createApiTokenAction, {})
  const [copied, setCopied] = useState(false)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Token name</span>
          <input
            name="name"
            required
            maxLength={80}
            placeholder="Claude on my laptop"
            className="w-72 max-w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <Submit />
      </form>
      {state.error && <p className="mt-3 text-sm text-red-600">{state.error}</p>}
      {state.token && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="mb-2 text-sm font-medium text-amber-900">
            Copy your new token “{state.name}” now. You won’t be able to see it again.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1.5 font-mono text-xs text-gray-900 ring-1 ring-amber-200">
              {state.token}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(state.token!).then(() => setCopied(true), () => setCopied(false))
              }}
              className="rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
