'use client'

import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { createProjectAction, type NewProjectState } from '@/app/projects/actions'
import { EntitySelect, type EntityOption } from '@/components/EntitySelect'
import { ProjectNotesField } from '@/components/EditProjectForm'
import { ProjectTypeFields } from '@/components/ProjectTypeFields'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Creating…' : 'Create project'}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-gray-400">{label}</span>
      {children}
    </label>
  )
}

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

export function NewProjectForm({ clients, entities = [] }: { clients: { id: string; name: string }[]; entities?: EntityOption[] }) {
  const [state, formAction] = useFormState<NewProjectState, FormData>(createProjectAction, {})
  const [projectType, setProjectType] = useState('time_and_materials')
  const [rateMethod, setRateMethod] = useState('none')

  return (
    <details className="mb-6 rounded-lg border border-gray-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-brand-green">+ New project</summary>
      <form action={formAction} className="space-y-4 border-t border-gray-100 p-4">
        <div className="flex flex-wrap gap-3">
          <Field label="Client">
            <select name="clientId" required className={`${input} min-w-56`}>
              <option value="">Select…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Name">
            <input name="name" required className={`${input} w-64`} />
          </Field>
          <Field label="Code">
            <input name="code" placeholder="optional" className={`${input} w-32`} />
          </Field>
          <EntitySelect entities={entities} name="entityId" help="Defaults to the client's company" />
        </div>

        <ProjectNotesField initialHtml="" />

        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Project type</span>
          <ProjectTypeFields
            projectType={projectType}
            setProjectType={setProjectType}
            rateMethod={rateMethod}
            setRateMethod={setRateMethod}
          />
        </div>

        <div className="flex items-center gap-3">
          <Submit />
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          <span className="text-xs text-gray-400">Common tasks are auto-added; you&apos;re added as PM.</span>
        </div>
      </form>
    </details>
  )
}
