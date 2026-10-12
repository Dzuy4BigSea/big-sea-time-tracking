'use client'

import { useRouter } from 'next/navigation'

/**
 * Harvest-style person switcher on /timesheet, shown only to people with
 * `view_edit_others_time`. It only changes the `?user=` param; the page and every server
 * action re-authorize the chosen person.
 */
export function TimesheetPersonSwitcher({
  people,
  selectedId,
  selfId,
  week,
}: {
  people: { id: string; name: string }[]
  selectedId: string
  selfId: string
  week: string
}) {
  const router = useRouter()
  return (
    <label className="flex items-center gap-2 text-sm text-gray-500">
      <span>Timesheet for</span>
      <select
        value={selectedId}
        onChange={(e) => router.push(`/timesheet?week=${week}&user=${encodeURIComponent(e.target.value)}`)}
        className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800"
        aria-label="Select person"
      >
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.id === selfId ? `${p.name} (you)` : p.name}
          </option>
        ))}
      </select>
    </label>
  )
}
