'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { updateModulesAction, type SettingsState } from '@/app/settings/actions'

export interface ModuleFlags {
  timeTracking: boolean
  expenseTracking: boolean
  timesheetApproval: boolean
  team: boolean
  invoices: boolean
  estimates: boolean
  clientDashboard: boolean
  activityLog: boolean
}

const ROWS: { key: keyof ModuleFlags; label: string; desc: string }[] = [
  { key: 'timeTracking', label: 'Time tracking', desc: 'Timesheet and timers' },
  { key: 'expenseTracking', label: 'Expense tracking', desc: 'Expenses and categories' },
  { key: 'timesheetApproval', label: 'Timesheet approval', desc: 'Submit / approve / reopen workflow' },
  { key: 'team', label: 'Team', desc: 'People management' },
  { key: 'invoices', label: 'Invoices', desc: 'Invoices, recurring, retainers' },
  { key: 'estimates', label: 'Estimates', desc: 'Estimates and conversion to invoices' },
  { key: 'clientDashboard', label: 'Client dashboard', desc: 'Client-facing portal' },
  { key: 'activityLog', label: 'Activity log', desc: 'Audit report (Premium)' },
]

function Save() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Save modules'}
    </button>
  )
}

export function ModulesForm({ modules }: { modules: ModuleFlags }) {
  const [state, formAction] = useFormState<SettingsState, FormData>(updateModulesAction, {})

  return (
    <form action={formAction} className="space-y-1 rounded-lg border border-gray-200 bg-white p-5">
      {ROWS.map((r) => (
        <label key={r.key} className="flex items-center justify-between gap-4 border-b border-gray-50 py-2 last:border-0">
          <span>
            <span className="text-sm font-medium text-gray-800">{r.label}</span>
            <span className="ml-2 text-xs text-gray-400">{r.desc}</span>
          </span>
          <input type="checkbox" name={r.key} defaultChecked={modules[r.key]} className="h-4 w-4" />
        </label>
      ))}
      <div className="flex items-center gap-3 pt-3">
        <Save />
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-brand-green">Saved ✓</span>}
      </div>
    </form>
  )
}
