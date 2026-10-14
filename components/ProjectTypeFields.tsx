'use client'

import { useState } from 'react'

/**
 * Harvest-style "Project type" picker: three cards (Time & Materials / Fixed Fee / Non-Billable)
 * with the chosen type's options (billable rate or project fee, then budget) in a panel below.
 * Shared by the New and Edit project forms. Posts the same field names the project server actions
 * already read (projectType, billableRateMethod, projectRate, projectFees, budgetMethod, budgetHours,
 * budgetFee, budgetAlertPercent, budgetResetsMonthly).
 */

const TYPES = [
  { value: 'time_and_materials', label: 'Time & Materials', hint: 'Bill by the hour, with billable rates' },
  { value: 'fixed_fee', label: 'Fixed Fee', hint: 'Bill a set price, regardless of time tracked' },
  { value: 'non_billable', label: 'Non-Billable', hint: 'Not billed to a client' },
] as const

const input = 'rounded border border-gray-300 bg-white px-2 py-1.5 text-sm'

export interface ProjectTypeDefaults {
  projectRate?: string
  projectFees?: string
  budgetMethod?: string
  budgetHours?: string
  budgetFee?: string
  budgetAlertPercent?: string
  budgetResetsMonthly?: boolean
}

export function ProjectTypeFields({
  projectType,
  setProjectType,
  rateMethod,
  setRateMethod,
  defaults = {},
  onChange,
}: {
  projectType: string
  setProjectType: (v: string) => void
  rateMethod: string
  setRateMethod: (v: string) => void
  defaults?: ProjectTypeDefaults
  /** Called on card clicks (they aren't form inputs, so the form's onChange doesn't see them). */
  onChange?: () => void
}) {
  const [budget, setBudget] = useState(defaults.budgetMethod ?? 'none')
  const [alertOn, setAlertOn] = useState(Boolean(defaults.budgetAlertPercent))
  const isTM = projectType === 'time_and_materials'
  const isFixed = projectType === 'fixed_fee'
  const activeIndex = TYPES.findIndex((t) => t.value === projectType)

  return (
    <div>
      <input type="hidden" name="projectType" value={projectType} />
      <div role="radiogroup" aria-label="Project type" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {TYPES.map((t) => {
          const active = t.value === projectType
          return (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                setProjectType(t.value)
                onChange?.()
              }}
              className={`rounded-md border px-3 py-2.5 text-center transition-colors ${
                active
                  ? 'border-brand-teal bg-brand-teal-50 text-brand-teal'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50'
              }`}
            >
              <span className="block text-sm font-semibold">{t.label}</span>
              <span className={`block text-xs ${active ? 'text-brand-teal' : 'text-gray-500'}`}>{t.hint}</span>
            </button>
          )
        })}
      </div>

      {/* Options panel, with a caret pointing at the chosen card (sm+ only, where cards sit in a row). */}
      <div className="relative mt-3 rounded-md border border-brand-teal/30 bg-brand-teal-50 p-4">
        <span
          aria-hidden
          className="absolute -top-[7px] hidden h-3 w-3 rotate-45 border-l border-t border-brand-teal/30 bg-brand-teal-50 sm:block"
          style={{ left: `calc(${(activeIndex * 2 + 1) * (100 / 6)}% - 6px)` }}
        />
        <div className="space-y-4">
          {isTM && (
            <Section title="Billable rates" hint="We need billable rates to track your project's billable amount.">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  name="billableRateMethod"
                  value={rateMethod}
                  onChange={(e) => setRateMethod(e.target.value)}
                  className={input}
                  aria-label="Billable rate"
                >
                  <option value="none">No billable rate</option>
                  <option value="project">Project billable rate</option>
                  <option value="person">Person billable rate</option>
                  <option value="task">Task billable rate</option>
                </select>
                {rateMethod === 'project' && (
                  <span className="flex items-center gap-1 text-sm text-gray-600">
                    $
                    <input
                      name="projectRate"
                      defaultValue={defaults.projectRate}
                      placeholder="0.00"
                      aria-label="Project rate per hour"
                      className={`${input} w-24`}
                    />
                    per hour
                  </span>
                )}
                {rateMethod === 'person' && <span className="text-xs text-gray-500">Set rates in the Team section below.</span>}
                {rateMethod === 'task' && <span className="text-xs text-gray-500">Set rates per task on the project&apos;s Tasks tab.</span>}
              </div>
            </Section>
          )}

          {isFixed && (
            <Section title="Project fees" hint="Enter the amount you plan to invoice.">
              <span className="flex items-center gap-1 text-sm text-gray-600">
                $
                <input
                  name="projectFees"
                  defaultValue={defaults.projectFees}
                  placeholder="0.00"
                  aria-label="Project fees"
                  className={`${input} w-32`}
                />
              </span>
            </Section>
          )}

          <Section title="Budget" hint="Set a budget to track project progress.">
            <div className="flex flex-wrap items-center gap-2">
              <select name="budgetMethod" value={budget} onChange={(e) => setBudget(e.target.value)} className={input} aria-label="Budget">
                <option value="none">No budget</option>
                <option value="hours_total">Total project hours</option>
                <option value="fee_total">Total project fees</option>
              </select>
              {budget === 'hours_total' && (
                <span className="flex items-center gap-1 text-sm text-gray-600">
                  <input name="budgetHours" defaultValue={defaults.budgetHours} placeholder="0" aria-label="Budget hours" className={`${input} w-24`} />
                  hours
                </span>
              )}
              {budget === 'fee_total' && (
                <span className="flex items-center gap-1 text-sm text-gray-600">
                  $
                  <input name="budgetFee" defaultValue={defaults.budgetFee} placeholder="0.00" aria-label="Budget fees" className={`${input} w-28`} />
                </span>
              )}
            </div>
            {budget !== 'none' && (
              <div className="mt-3 space-y-2 text-sm text-gray-700">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="budgetResetsMonthly" defaultChecked={defaults.budgetResetsMonthly} className="h-4 w-4 accent-brand-teal" />
                  Budget resets every month
                </label>
                <label className="flex flex-wrap items-center gap-2">
                  <input type="checkbox" checked={alertOn} onChange={(e) => setAlertOn(e.target.checked)} className="h-4 w-4 accent-brand-teal" />
                  Send email alerts if project exceeds
                  {/* Disabled inputs aren't posted, so unchecking clears the alert (budgetAlertPercent → null). */}
                  <input
                    name="budgetAlertPercent"
                    disabled={!alertOn}
                    defaultValue={defaults.budgetAlertPercent || '80'}
                    aria-label="Alert percent of budget"
                    className={`${input} w-20 disabled:bg-gray-100 disabled:text-gray-400`}
                  />
                  % of budget
                </label>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-semibold text-gray-800">{title}</div>
      <div className="mb-2 text-xs text-gray-500">{hint}</div>
      {children}
    </div>
  )
}
