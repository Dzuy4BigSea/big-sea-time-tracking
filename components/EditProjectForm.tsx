'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { updateProjectAction, type EditProjectState } from '@/app/projects/actions'
import { EntitySelect, type EntityOption } from '@/components/EntitySelect'
import { useProjectBilling } from '@/components/ProjectBillingContext'
import { useLeavePageGuard } from '@/components/useLeavePageGuard'
import { ProjectTypeFields } from '@/components/ProjectTypeFields'
import dynamic from 'next/dynamic'

// The editor (TipTap) loads in its own chunk so the Projects list doesn't ship it up front. Until it
// loads there's no `notes` input, and updateProjectAction then leaves the notes untouched.
const RichTextEditor = dynamic(() => import('@/components/RichTextEditor').then((m) => m.RichTextEditor), {
  ssr: false,
  loading: () => <div className="h-[12.5rem] rounded border border-gray-300 bg-gray-50" aria-hidden />,
})

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:bg-brand-green-d disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Update project'}
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

/** Harvest's label-left form row. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-gray-100 pt-4 first:border-t-0 first:pt-0 md:grid-cols-[10rem_1fr] md:gap-4">
      <div className="text-sm font-medium text-gray-700 md:pt-2">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
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
  /** Sanitized notes HTML (modules/projects/notes.ts → projectNotesHtml); '' when none. */
  notesHtml: string
}

export function EditProjectForm({ project, entities = [] }: { project: EditableProject; entities?: EntityOption[] }) {
  const [state, formAction] = useFormState<EditProjectState, FormData>(updateProjectAction, {})
  // Inside ProjectBillingProvider the type/rate method are shared with the Team card (its Billable
  // rate column follows the select instantly); standalone, the form keeps its own state.
  const shared = useProjectBilling()
  const [localType, setLocalType] = useState(project.projectType)
  const [localMethod, setLocalMethod] = useState(project.billableRateMethod ?? 'none')
  const projectType = shared?.projectType ?? localType
  const setProjectType = shared?.setProjectType ?? setLocalType
  const rateMethod = shared?.rateMethod ?? localMethod
  const setRateMethod = shared?.setRateMethod ?? setLocalMethod
  // Leave-page guard: any edit marks the form dirty until it saves.
  const [dirty, setDirty] = useState(false)
  useLeavePageGuard(dirty)
  useEffect(() => {
    if (state.ok) setDirty(false)
  }, [state])
  const dollars = (c: number | null) => (c ? (c / 100).toString() : '')
  const budgetMethod = project.budgetMethod === 'hours_total' || project.budgetMethod === 'fee_total' ? project.budgetMethod : 'none'

  return (
    <form action={formAction} onChange={() => setDirty(true)} className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <input type="hidden" name="id" value={project.id} />

      <Row label="Client">
        <div className="text-sm text-gray-800 md:pt-2">{project.clientName}</div>
      </Row>

      <Row label="Project">
        <div className="flex flex-wrap gap-3">
          <Field label="Name">
            <input name="name" required defaultValue={project.name} className={`${input} w-64`} />
          </Field>
          <Field label="Code">
            <input name="code" defaultValue={project.code ?? ''} className={`${input} w-32`} />
          </Field>
          <EntitySelect entities={entities} name="entityId" defaultValue={project.entityId} label="Company" />
        </div>
      </Row>

      <Row label="Notes">
        <ProjectNotesField initialHtml={project.notesHtml} onChange={() => setDirty(true)} hideLabel />
      </Row>

      <Row label="Project type">
        <ProjectTypeFields
          projectType={projectType}
          setProjectType={setProjectType}
          rateMethod={rateMethod}
          setRateMethod={setRateMethod}
          onChange={() => setDirty(true)}
          defaults={{
            projectRate: dollars(project.projectHourlyRateCents),
            projectFees: dollars(project.projectFeesCents),
            budgetMethod,
            budgetHours: budgetMethod === 'hours_total' && project.budgetValue ? (project.budgetValue / 60).toString() : '',
            budgetFee: budgetMethod === 'fee_total' ? dollars(project.budgetValue) : '',
            budgetAlertPercent: project.budgetAlertPercent?.toString() ?? '',
            budgetResetsMonthly: project.budgetResetsMonthly,
          }}
        />
      </Row>

      {/* Anchored to the bottom of the viewport (Harvest). Fixed rather than sticky: the Shell's <main>
          is an overflow container that never scrolls itself, so sticky wouldn't stick. The Tasks and
          Team cards below save on their own; this saves the fields above. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 backdrop-blur lg:left-[238px]">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-8">
          <Submit />
          <Link
            href={`/projects/${project.id}`}
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </Link>
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state.ok && !dirty && <span className="text-sm text-brand-green">Saved ✓</span>}
        </div>
      </div>
    </form>
  )
}

/** Notes (Harvest's "Notes" on Edit project), rich text. Shared with the New project form. */
export function ProjectNotesField({
  initialHtml,
  onChange,
  hideLabel,
}: {
  initialHtml: string
  onChange?: () => void
  hideLabel?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      {!hideLabel && <span className="text-xs uppercase tracking-wide text-gray-400">Notes</span>}
      <RichTextEditor name="notes" initialHtml={initialHtml} onChange={onChange} label="Project notes" />
      <span className="text-xs text-gray-500">
        Optional. Notes are great for anything you need to reference later, like invoice schedules, which you can see when
        creating an invoice for Fixed Fee projects.
      </span>
    </div>
  )
}
