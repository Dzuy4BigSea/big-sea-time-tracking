'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { updateProjectAction, type EditProjectState } from '@/app/projects/actions'
import { EntitySelect, type EntityOption } from '@/components/EntitySelect'

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

function Submit() {
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-gray-400">{label}</span>
      {children}
    </label>
  )
}

export interface EditableProject {
  id: string
  name: string
  code: string | null
  clientName: string
  projectType: string
  billableRateMethod: string | null
  projectHourlyRateCents: number | null
  projectFeesCents: number | null
  budgetMethod: string
  budgetValue: number | null
  budgetResetsMonthly: boolean
  budgetAlertPercent: number | null
  entityId: string | null
}

export function EditProjectForm({ project, entities = [] }: { project: EditableProject; entities?: EntityOption[] }) {
  const [state, formAction] = useFormState<EditProjectState, FormData>(updateProjectAction, {})
  const [projectType, setProjectType] = useState(project.projectType)
  const [rateMethod, setRateMethod] = useState(project.billableRateMethod ?? 'none')
  const initialBudget =
    project.budgetMethod === 'hours_total' ? 'hours_total' : project.budgetMethod === 'fee_total' ? 'fee_total' : 'none'
  const [budget, setBudget] = useState(initialBudget)

  const isTM = projectType === 'time_and_materials'
  const isFixed = projectType === 'fixed_fee'
  const dollars = (c: number | null) => (c ? (c / 100).toString() : '')

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <input type="hidden" name="id" value={project.id} />
      <div className="text-xs text-gray-400">Client: {project.clientName} (fixed)</div>

      <div className="flex flex-wrap gap-3">
        <Field label="Name">
          <input name="name" required defaultValue={project.name} className={`${input} w-64`} />
        </Field>
        <Field label="Code">
          <input name="code" defaultValue={project.code ?? ''} className={`${input} w-32`} />
        </Field>
        <EntitySelect entities={entities} name="entityId" defaultValue={project.entityId} label="Company" />
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
            <input name="projectRate" defaultValue={dollars(project.projectHourlyRateCents)} className={`${input} w-28`} />
          </Field>
        )}
        {isFixed && (
          <Field label="Project fees ($)">
            <input name="projectFees" defaultValue={dollars(project.projectFeesCents)} className={`${input} w-32`} />
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
            <input
              name="budgetHours"
              defaultValue={project.budgetValue ? (project.budgetValue / 60).toString() : ''}
              className={`${input} w-24`}
            />
          </Field>
        )}
        {budget === 'fee_total' && (
          <Field label="Budget fees ($)">
            <input name="budgetFee" defaultValue={dollars(project.budgetValue)} className={`${input} w-28`} />
          </Field>
        )}
        {budget !== 'none' && (
          <>
            <Field label="Alert at (%)">
              <input name="budgetAlertPercent" defaultValue={project.budgetAlertPercent?.toString() ?? ''} className={`${input} w-20`} />
            </Field>
            <label className="flex items-center gap-1.5 pb-2 text-sm text-gray-600">
              <input type="checkbox" name="budgetResetsMonthly" defaultChecked={project.budgetResetsMonthly} /> Resets monthly
            </label>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Submit />
        <Link href={`/projects/${project.id}`} className="text-sm text-gray-500 hover:text-brand-teal">
          Back to project
        </Link>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-brand-green">Saved ✓</span>}
      </div>
    </form>
  )
}
