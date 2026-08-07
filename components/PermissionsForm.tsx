'use client'

import { useMemo, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { updatePersonPermissionsAction } from '@/app/team/actions'
import type { EditPersonState } from '@/app/team/actions'

export type CapItem = { key: string; label: string }
export type CapGroup = { heading: string; capabilities: CapItem[] }
export type ProfileItem = { value: string; label: string; description: string }

function Save() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
      {pending ? 'Saving…' : 'Save access'}
    </button>
  )
}

export function PermissionsForm({
  personId,
  initialProfile,
  initialChecked,
  profiles,
  profileBase,
  scoped,
  groups,
  selfEditingLocked,
}: {
  personId: string
  initialProfile: string
  initialChecked: string[]
  profiles: ProfileItem[]
  /** base capabilities per profile — used to reset abilities when the role changes */
  profileBase: Record<string, string[]>
  /** scoped capabilities per profile (rendered with a note) */
  scoped: Record<string, string[]>
  groups: CapGroup[]
  selfEditingLocked: boolean
}) {
  const [state, formAction] = useFormState<EditPersonState, FormData>(updatePersonPermissionsAction, {})
  const [profile, setProfile] = useState(initialProfile)
  const [checked, setChecked] = useState<Set<string>>(new Set(initialChecked))

  const scopedSet = useMemo(() => new Set(scoped[profile] ?? []), [scoped, profile])
  const baseSet = useMemo(() => new Set(profileBase[profile] ?? []), [profileBase, profile])
  const customized = useMemo(() => {
    const cur = checked
    const base = baseSet
    if (cur.size !== base.size) return true
    for (const c of cur) if (!base.has(c)) return true
    return false
  }, [checked, baseSet])

  const onProfileChange = (p: string) => {
    setProfile(p)
    setChecked(new Set(profileBase[p] ?? [])) // switching role resets abilities to that role's defaults
  }
  const toggle = (cap: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(cap)) next.delete(cap)
      else next.add(cap)
      return next
    })
  }

  const desc = profiles.find((p) => p.value === profile)?.description

  return (
    <form action={formAction} className="space-y-5 rounded-lg border border-gray-200 bg-white p-5">
      <input type="hidden" name="id" value={personId} />

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Access level</label>
        <select
          name="profile"
          value={profile}
          onChange={(e) => onProfileChange(e.target.value)}
          disabled={selfEditingLocked}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400"
        >
          {profiles.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {desc && <p className="mt-1 text-xs text-gray-500">{desc}</p>}
        {selfEditingLocked && <p className="mt-1 text-xs text-amber-600">You can’t change your own access level.</p>}
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Abilities</span>
          {customized && <span className="text-[11px] text-brand-teal">Customized for this person</span>}
        </div>
        <p className="mb-3 text-xs text-gray-400">
          Start from the role’s defaults, then tick or untick individual abilities to tailor this person’s access.
        </p>
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.heading}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{g.heading}</div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {g.capabilities.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" name="cap" value={c.key} checked={checked.has(c.key)} onChange={() => toggle(c.key)} className="h-4 w-4" />
                    <span>
                      {c.label}
                      {scopedSet.has(c.key) && checked.has(c.key) && (
                        <span className="ml-1 text-[11px] text-gray-400">(their projects only)</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Save />
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-brand-green">Access saved ✓</span>}
      </div>
    </form>
  )
}
