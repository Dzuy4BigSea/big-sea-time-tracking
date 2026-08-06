'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { updatePreferencesAction, type SettingsState } from '@/app/settings/actions'

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

export interface AccountPrefs {
  name: string
  timezone: string
  baseCurrency: string
  dateFormat: string
  fiscalYearStartMonth: number
  defaultCapacityHours: number
  weekStartsOn: string
  timeRounding: string
  timeEntryNotes: string
  timeFormatClock: string
  timeDisplay: string
  timerMode: string
  expenseReimbursement: string
}

function Save() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Save preferences'}
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function PreferencesForm({ prefs }: { prefs: AccountPrefs }) {
  const [state, formAction] = useFormState<SettingsState, FormData>(updatePreferencesAction, {})

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company name">
          <input name="name" required defaultValue={prefs.name} className={input} />
        </Field>
        <Field label="Timezone">
          <input name="timezone" defaultValue={prefs.timezone} className={input} />
        </Field>
        <Field label="Base currency">
          <input name="baseCurrency" defaultValue={prefs.baseCurrency} maxLength={3} className={`${input} w-24 uppercase`} />
        </Field>
        <Field label="Date format">
          <select name="dateFormat" defaultValue={prefs.dateFormat} className={input}>
            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
          </select>
        </Field>
        <Field label="Fiscal year starts">
          <select name="fiscalYearStartMonth" defaultValue={String(prefs.fiscalYearStartMonth)} className={input}>
            {MONTHS.map((m, i) => (
              <option key={m} value={String(i + 1)}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Default capacity (h/wk)">
          <input name="defaultCapacityHours" defaultValue={String(prefs.defaultCapacityHours)} className={`${input} w-24`} />
        </Field>
        <Field label="Start week on">
          <select name="weekStartsOn" defaultValue={prefs.weekStartsOn} className={input}>
            <option value="monday">Monday</option>
            <option value="sunday">Sunday</option>
          </select>
        </Field>
        <Field label="Time rounding (summary/invoice only)">
          <select name="timeRounding" defaultValue={prefs.timeRounding} className={input}>
            <option value="none">No rounding</option>
            <option value="nearest_1">Nearest 1 min</option>
            <option value="nearest_5">Nearest 5 min</option>
            <option value="nearest_6">Nearest 6 min</option>
            <option value="nearest_10">Nearest 10 min</option>
            <option value="nearest_15">Nearest 15 min</option>
          </select>
        </Field>
        <Field label="Time entry notes">
          <select name="timeEntryNotes" defaultValue={prefs.timeEntryNotes} className={input}>
            <option value="optional">Optional</option>
            <option value="required">Required</option>
          </select>
        </Field>
        <Field label="Time format">
          <select name="timeFormatClock" defaultValue={prefs.timeFormatClock} className={input}>
            <option value="h12">12-hour</option>
            <option value="h24">24-hour</option>
          </select>
        </Field>
        <Field label="Time display">
          <select name="timeDisplay" defaultValue={prefs.timeDisplay} className={input}>
            <option value="hh_mm">HH:MM (1:30)</option>
            <option value="decimal">Decimal (1.50)</option>
          </select>
        </Field>
        <Field label="Timer mode">
          <select name="timerMode" defaultValue={prefs.timerMode} className={input}>
            <option value="duration">Track via duration</option>
            <option value="start_stop">Start/stop timer</option>
          </select>
        </Field>
        <Field label="Expense reimbursement">
          <select name="expenseReimbursement" defaultValue={prefs.expenseReimbursement} className={input}>
            <option value="disabled">Do not allow</option>
            <option value="allowed">Allow requests</option>
          </select>
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Save />
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-brand-green">Saved ✓</span>}
      </div>
    </form>
  )
}
