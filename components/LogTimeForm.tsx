'use client'

import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { logTimeAction, type LogTimeState } from '@/app/timesheet/actions'

type ProjectOption = { id: string; name: string; tasks: { id: string; name: string }[] }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Log time'}
    </button>
  )
}

export function LogTimeForm({
  projects,
  userId,
  defaultDate,
}: {
  projects: ProjectOption[]
  userId: string
  defaultDate: string
}) {
  const [state, formAction] = useFormState<LogTimeState, FormData>(logTimeAction, {})
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const tasks = projects.find((p) => p.id === projectId)?.tasks ?? []

  if (projects.length === 0) {
    return <p className="text-sm text-gray-400">No projects assigned to this user — nothing to log against.</p>
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <input type="hidden" name="userId" value={userId} />

      <Field label="Project">
        <select
          name="projectId"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="min-w-48 rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Task">
        <select name="taskId" className="min-w-40 rounded border border-gray-300 px-2 py-1.5 text-sm">
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Date">
        <input type="date" name="spentDate" defaultValue={defaultDate} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </Field>

      <Field label="Duration">
        <input
          name="duration"
          placeholder="1:30 / 1.5 / 90m"
          className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </Field>

      <Field label="Notes">
        <input name="notes" placeholder="optional" className="w-40 rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </Field>

      <SubmitButton />

      {state.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="w-full text-sm text-brand-green">Logged ✓</p>}
    </form>
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
