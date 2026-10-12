'use client'

import { useEffect, useState } from 'react'
import { Combobox } from '@/components/Combobox'
import { useProjectBilling } from '@/components/ProjectBillingContext'
import { formatCents } from '@/lib/format'
import { usesPersonRates, type RateCell } from '@/modules/projects/teamCard'
import {
  assignUserToProjectAction,
  toggleProjectManagerAction,
  unassignUserFromProjectAction,
  setProjectUserRateAction,
} from '@/app/projects/actions'

export interface TeamRow {
  userId: string
  name: string
  initials: string
  archived: boolean
  isProjectManager: boolean
  billable: RateCell
  cost: RateCell
}

const fd = (fields: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

/**
 * Harvest-style Team card body for the Edit project page. Every change saves immediately through
 * the existing project server actions (they re-check `manage_projects` and tenant scope).
 * The Billable rate column follows the form's (unsaved) rate method via ProjectBillingContext,
 * falling back to the saved value outside the provider.
 */
export function ProjectTeamTable({
  projectId,
  savedProjectType,
  savedRateMethod,
  rows,
  addable,
}: {
  projectId: string
  savedProjectType: string
  savedRateMethod: string | null
  rows: TeamRow[]
  addable: { id: string; name: string }[]
}) {
  const billing = useProjectBilling()
  const showBillable = usesPersonRates(billing?.projectType ?? savedProjectType, billing ? billing.rateMethod : savedRateMethod)
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
  const manageable = rows.filter((r) => !r.archived)
  const selectAll = () =>
    run(
      manageable
        .filter((r) => !r.isProjectManager)
        .map((r) => () => assignUserToProjectAction(fd({ projectId, userId: r.userId, isProjectManager: 'on' }))),
    )
  const selectNone = () =>
    run(manageable.filter((r) => r.isProjectManager).map((r) => () => toggleProjectManagerAction(fd({ projectId, userId: r.userId }))))
  const assign = (userId: string) => {
    if (!userId) return
    void run([() => assignUserToProjectAction(fd({ projectId, userId }))]).then(() => setPickerKey((k) => k + 1))
  }

  const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-400'
  return (
    <div className={`overflow-x-auto rounded-lg border border-gray-200 bg-white ${busy ? 'opacity-70' : ''}`} aria-busy={busy}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className={`${th} w-8`} aria-label="Remove" />
            <th className={th}>Team</th>
            {showBillable && <th className={th}>Billable rate</th>}
            <th className={th}>Cost rate</th>
            <th className={`${th} text-right normal-case tracking-normal`}>
              <span className="uppercase tracking-wide">Manages this project</span>{' '}
              <button type="button" disabled={busy} onClick={selectAll} className="text-blue-600 hover:underline disabled:opacity-50">
                Select All
              </button>
              {' / '}
              <button type="button" disabled={busy} onClick={selectNone} className="text-blue-600 hover:underline disabled:opacity-50">
                None
              </button>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <Row key={r.userId} projectId={projectId} r={r} showBillable={showBillable} busy={busy} />
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={showBillable ? 5 : 4} className="px-3 py-3 text-gray-400">
                No one assigned yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="border-t border-gray-100 bg-gray-50 px-3 py-3">
        <Combobox
          key={pickerKey}
          name="userId"
          aria-label="Assign a person"
          placeholder={addable.length ? 'Assign a person...' : 'Everyone is assigned'}
          disabled={busy || addable.length === 0}
          options={addable.map((u) => ({ value: u.id, label: u.name }))}
          onValueChange={assign}
          className="w-72"
        />
      </div>
    </div>
  )
}

function Row({ projectId, r, showBillable, busy }: { projectId: string; r: TeamRow; showBillable: boolean; busy: boolean }) {
  // Optimistic PM checkbox; re-syncs when the server re-renders with the saved value.
  const [pm, setPm] = useState(r.isProjectManager)
  useEffect(() => setPm(r.isProjectManager), [r.isProjectManager])
  const [editing, setEditing] = useState(false)

  return (
    <tr className={r.archived ? 'bg-gray-50 text-gray-400' : ''}>
      <td className="px-3 py-2 align-middle">
        <form action={unassignUserFromProjectAction}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="userId" value={r.userId} />
          <button
            className="text-gray-400 hover:text-red-600"
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
      <td className="px-3 py-2">
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${r.archived ? 'bg-gray-400' : 'bg-brand-ink'}`}
          >
            {r.initials}
          </span>
          <span className={r.archived ? '' : 'font-medium text-gray-800'}>{r.name}</span>
          {r.archived && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-600">Archived</span>}
        </span>
      </td>
      {showBillable && (
        <td className="px-3 py-2">
          {editing ? (
            <form
              action={async (f: FormData) => {
                await setProjectUserRateAction(f)
                setEditing(false)
              }}
              className="flex items-center gap-1"
            >
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="userId" value={r.userId} />
              <span className="text-xs text-gray-400">$</span>
              <input
                name="rate"
                autoFocus
                defaultValue={r.billable.kind === 'custom' ? (r.billable.cents / 100).toFixed(2) : ''}
                placeholder="rate/h"
                className="w-20 rounded border border-gray-300 px-1.5 py-1 text-xs"
              />
              <button className="text-xs text-brand-teal hover:underline">Save</button>
              <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:underline">
                Cancel
              </button>
            </form>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <RateDisplay cell={r.billable} />
              {!r.archived && (
                <button type="button" onClick={() => setEditing(true)} className="text-xs text-blue-600 hover:underline">
                  {r.billable.kind === 'custom' ? 'Edit custom rate' : 'Apply custom rate'}
                </button>
              )}
              {r.billable.kind === 'custom' && !r.archived && (
                <form action={setProjectUserRateAction}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="userId" value={r.userId} />
                  <input type="hidden" name="rate" value="" />
                  <button className="text-xs text-gray-500 hover:underline">Use default</button>
                </form>
              )}
            </span>
          )}
        </td>
      )}
      <td className="px-3 py-2">
        <RateDisplay cell={r.cost} />
      </td>
      <td className="px-3 py-2 text-right">
        <input
          type="checkbox"
          checked={pm}
          disabled={r.archived || busy}
          aria-label={`${r.name} manages this project`}
          title={r.archived ? 'Archived people cannot manage projects' : 'Manages this project'}
          onChange={async () => {
            setPm(!pm)
            await toggleProjectManagerAction(fd({ projectId, userId: r.userId }))
          }}
          className="h-4 w-4 accent-brand-teal disabled:opacity-50"
        />
      </td>
    </tr>
  )
}

function RateDisplay({ cell }: { cell: RateCell }) {
  if (cell.kind === 'missing') return <span className="text-xs italic text-gray-400">Missing rate</span>
  return (
    <span className="flex items-center gap-1.5">
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cell.kind === 'custom' ? 'bg-brand-teal-50 text-brand-teal' : 'bg-gray-100 text-gray-600'}`}>
        {cell.kind === 'custom' ? 'Custom rate' : 'Person default'}
      </span>
      <span className="tabular-nums">{formatCents(cell.cents)}</span>
    </span>
  )
}
