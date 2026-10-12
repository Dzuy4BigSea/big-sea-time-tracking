/** Pure helpers for the /timesheet "Teammates" popover (components/TimesheetPersonSwitcher.tsx). */

export type TeammateType = 'employee' | 'contractor'

export interface TeammateOption {
  id: string
  name: string
  /** User.type; a missing value counts as an employee (the schema default). */
  type?: TeammateType
}

export interface TeammateGroup<T extends TeammateOption> {
  label: 'Employees' | 'Contractors'
  people: T[]
}

/**
 * Harvest's Teammates list groups people under "Employees" then "Contractors". Order within a
 * group is preserved (self first, then alphabetical, as listActablePeople returns them); empty
 * groups are dropped.
 */
export function groupTeammates<T extends TeammateOption>(people: readonly T[]): TeammateGroup<T>[] {
  const employees = people.filter((p) => p.type !== 'contractor')
  const contractors = people.filter((p) => p.type === 'contractor')
  const groups: TeammateGroup<T>[] = []
  if (employees.length) groups.push({ label: 'Employees', people: employees })
  if (contractors.length) groups.push({ label: 'Contractors', people: contractors })
  return groups
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
