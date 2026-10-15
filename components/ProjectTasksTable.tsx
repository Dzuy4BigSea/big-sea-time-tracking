'use client'

import { useEffect, useState } from 'react'
import { Combobox, type ComboOption } from '@/components/Combobox'
import { useProjectBilling } from '@/components/ProjectBillingContext'
import {
  addTaskToProjectAction,
  removeTaskFromProjectAction,
  setProjectTaskRateAction,
  toggleProjectTaskBillableAction,
} from '@/app/projects/actions'

export interface TaskRow {
  taskId: string
  name: string
  billable: boolean
  rateCents: number | null
}

export interface Teammate {
  id: string
  name: string
  initials: string
}

const fd = (fields: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

// Avatar fills, picked per person so the stack reads as different people (no photos yet).
const AVATAR_FILLS = ['bg-brand-teal', 'bg-brand-navy', 'bg-brand-purple', 'bg-brand-maroon', 'bg-brand-teal-l', 'bg-brand-stone', 'bg-brand-ink']
function fillFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return AVATAR_FILLS[Math.abs(h) % AVATAR_FILLS.length]
}

const MAX_AVATARS = 5

/**
 * Harvest-style Tasks card on the Edit project page. Every change saves immediately through the
 * project task server actions (they re-check `manage_projects` and tenant scope). The Billable
 * column follows the form's (unsaved) project type via ProjectBillingContext.
 */
export function ProjectTasksTable({
  projectId,
  rows,
  teammates,
  addable,
}: {
  projectId: string
  rows: TaskRow[]
  teammates: Teammate[]
  addable: ComboOption[]
}) {
  const billing = useProjectBilling()
  const showBillable = (billing?.projectType ?? 'time_and_materials') !== 'non_billable'
  const showRate = billing?.projectType === 'time_and_materials' && billing.rateMethod === 'task'
  const [busy, setBusy] = useState(false)
  const [pickerKey, setPickerKey] = useState(0)

  const run = async (calls: (() => Promise<void>)[]) => {
    setBusy(true)
    try {
      for (const c of calls) await c()
    } finally {
      setBusy(false)
    }
  }
  const setAllBillable = (to: boolean) =>
    run(rows.filter((r) => r.billable !== to).map((r) => () => toggleProjectTaskBillableAction(fd({ projectId, taskId: r.taskId }))))
  const add = (taskId: string) => {
    if (!taskId) return
    void run([() => addTaskToProjectAction(fd({ projectId, taskId }))]).then(() => setPickerKey((k) => k + 1))
  }

  const th = 'px-3 py-2 text-xs font-medium text-gray-500'
  const link = 'text-blue-600 underline hover:no-underline disabled:opacity-50'
  return (
    // Only the table scrolls sideways: an overflow container around the "Add a task..." picker would
    // clip its dropdown list at the card's bottom edge.
    <div className={`rounded-lg border border-gray-200 bg-white ${busy ? 'opacity-70' : ''}`} aria-busy={busy}>
      <div className="overflow-x-auto rounded-t-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60">
              <th className="px-3 py-2 text-left align-bottom" colSpan={2}>
                <h2 className="text-lg font-semibold text-gray-900">Tasks</h2>
              </th>
              <th className={`${th} text-right align-bottom`}>
                <div>Assigned teammates</div>
              </th>
              {showRate && <th className={`${th} text-left align-bottom`}>Billable rate</th>}
              {showBillable && (
                <th className={`${th} w-28 text-right align-bottom`}>
                  <div>Billable</div>
                  <div className="font-normal">
                    Select{' '}
                    <button type="button" disabled={busy} onClick={() => setAllBillable(true)} className={link}>
                      All
                    </button>
                    {' / '}
                    <button type="button" disabled={busy} onClick={() => setAllBillable(false)} className={link}>
                      None
                    </button>
                  </div>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr>
              <td colSpan={5} className="bg-brand-navy-50 px-3 py-2.5 text-sm text-brand-navy">
                Project teammates are assigned to every task by default.
              </td>
            </tr>
            {rows.map((r) => (
              <Row key={r.taskId} projectId={projectId} r={r} teammates={teammates} showBillable={showBillable} showRate={showRate} busy={busy} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-gray-400">
                  No tasks on this project yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t border-gray-100 px-3 py-3">
        <Combobox
          key={pickerKey}
          name="taskId"
          aria-label="Add a task"
          placeholder={addable.length ? 'Add a task...' : 'Every task is on this project'}
          disabled={busy || addable.length === 0}
          options={addable}
          onValueChange={add}
          className="w-full max-w-lg"
        />
      </div>
    </div>
  )
}

function Row({
  projectId,
  r,
  teammates,
  showBillable,
  showRate,
  busy,
}: {
  projectId: string
  r: TaskRow
  teammates: Teammate[]
  showBillable: boolean
  showRate: boolean
  busy: boolean
}) {
  // Optimistic billable checkbox; re-syncs when the server re-renders with the saved value.
  const [billable, setBillable] = useState(r.billable)
  useEffect(() => setBillable(r.billable), [r.billable])

  return (
    <tr>
      <td className="w-10 px-3 py-2 align-middle">
        <form action={removeTaskFromProjectAction}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="taskId" value={r.taskId} />
          <button
            className="flex h-6 w-6 items-center justify-center rounded border border-gray-300 text-xs text-gray-500 hover:border-red-300 hover:text-red-600"
            title={`Remove ${r.name} from this project`}
            aria-label={`Remove ${r.name} from this project`}
            onClick={(e) => {
              if (!confirm(`Remove ${r.name} from this project?`)) e.preventDefault()
            }}
          >
            ✕
          </button>
        </form>
      </td>
      <td className="px-1 py-2 text-gray-800">{r.name}</td>
      <td className="px-3 py-2">
        <AvatarStack people={teammates} />
      </td>
      {showRate && (
        <td className="px-3 py-2">
          <form action={setProjectTaskRateAction} className="flex items-center gap-1">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="taskId" value={r.taskId} />
            <span className="text-xs text-gray-400">$</span>
            <input
              name="rate"
              defaultValue={r.rateCents ? (r.rateCents / 100).toFixed(2) : ''}
              placeholder="rate/h"
              aria-label={`${r.name} billable rate`}
              className="w-20 rounded border border-gray-300 px-1.5 py-1 text-xs"
            />
            <button className="text-xs text-brand-teal hover:underline">Save</button>
          </form>
        </td>
      )}
      {showBillable && (
        <td className="px-3 py-2 text-right">
          <input
            type="checkbox"
            checked={billable}
            disabled={busy}
            aria-label={`${r.name} is billable`}
            onChange={async () => {
              setBillable(!billable)
              await toggleProjectTaskBillableAction(fd({ projectId, taskId: r.taskId }))
            }}
            className="h-4 w-4 accent-brand-teal disabled:opacity-50"
          />
        </td>
      )}
    </tr>
  )
}

function AvatarStack({ people }: { people: Teammate[] }) {
  if (people.length === 0) return <span className="block text-right text-xs italic text-gray-400">No teammates</span>
  const shown = people.slice(0, MAX_AVATARS)
  const extra = people.length - shown.length
  return (
    <div className="flex items-center justify-end" title={people.map((p) => p.name).join(', ')}>
      {shown.map((p) => (
        <span
          key={p.id}
          className={`-ml-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-white first:ml-0 ${fillFor(p.id)}`}
          aria-hidden
        >
          {p.initials}
        </span>
      ))}
      {extra > 0 && (
        <span className="-ml-1.5 flex h-7 min-w-[1.75rem] shrink-0 items-center justify-center rounded-full bg-gray-200 px-1 text-[10px] font-semibold text-gray-700 ring-2 ring-white">
          +{extra}
        </span>
      )}
      <span className="sr-only">{people.map((p) => p.name).join(', ')}</span>
    </div>
  )
}
