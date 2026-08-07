'use client'

import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { createProjectAction, type NewProjectState } from '@/app/projects/actions'
import { EntitySelect, type EntityOption } from '@/components/EntitySelect'

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
  const [budget, setBudget] = useState('none')

  const isTM = projectType === 'time_and_materials'
  const isFixed = projectType === 'fixed_fee'

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

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Project type">
            <select name="projectType" value={projectType} onChange={(e) => setProjectType(e.target.value)} className={input}>
              <option value="time_and_materials">Time &amp; Materials</option>
              <option value="fixed_fee">Fixed Fee</option>
              <option value="non_billable">Non-Billable</option>
            </select>
          </Field>

          {isTM && (
            <Field label="Billable rate">
              <select name="billableRateMethod" value={rateMethod} onChange={(e) => setRateMethod(e.target.value)} className={input}>
                <option value="none">No billable rate</option>
                <option value="project">Project rate</option>
                <option value="person">Person rate</option>
                <option value="task">Task rate</option>
              </select>
            </Field>
          )}

          {isTM && rateMethod === 'project' && (
            <Field label="Project rate ($/h)">
              <input name="projectRate" placeholder="150" className={`${input} w-28`} />
            </Field>
          )}

          {isFixed && (
            <Field label="Project fees ($)">
              <input name="projectFees" placeholder="5000" className={`${input} w-32`} />
            </Field>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Budget">
            <select name="budgetMethod" value={budget} onChange={(e) => setBudget(e.target.value)} className={input}>
              <option value="none">No budget</option>
              <option value="hours_total">Total hours</option>
              <option value="fee_total">Total fees</option>
            </select>
          </Field>
          {budget === 'hours_total' && (
            <Field label="Budget hours">
              <input name="budgetHours" placeholder="40" className={`${input} w-24`} />
            </Field>
          )}
          {budget === 'fee_total' && (
            <Field label="Budget fees ($)">
              <input name="budgetFee" placeholder="5000" className={`${input} w-28`} />
            </Field>
          )}
          {budget !== 'none' && (
            <>
              <Field label="Alert at (%)">
                <input name="budgetAlertPercent" placeholder="80" className={`${input} w-20`} />
              </Field>
              <label className="flex items-center gap-1.5 pb-2 text-sm text-gray-600">
                <input type="checkbox" name="budgetResetsMonthly" /> Resets monthly
              </label>
            </>
          )}
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
