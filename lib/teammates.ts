/** Pure helpers for the /timesheet "Teammates" popover (components/TimesheetPersonSwitcher.tsx). */

export interface TeammateOption {
  id: string
  name: string
}

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Filter people as you type: every whitespace-separated term must appear (case/accent-insensitive)
 * in the name, so "jo sm" finds "John Smith". Order is preserved.
 */
export function filterPeople<T extends TeammateOption>(people: readonly T[], query: string): T[] {
  const terms = norm(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...people]
  return people.filter((p) => {
    const hay = norm(p.name)
    return terms.every((t) => hay.includes(t))
  })
}

/**
 * The /timesheet URL for `userId`, keeping every other current param (week, …). Picking yourself
 * drops `?user=` so the URL is the plain own-timesheet one.
 */
export function timesheetHrefFor(currentParams: string | URLSearchParams, userId: string, selfId: string): string {
  const params = new URLSearchParams(currentParams)
  if (!userId || userId === selfId) params.delete('user')
  else params.set('user', userId)
  const qs = params.toString()
  return qs ? `/timesheet?${qs}` : '/timesheet'
}
