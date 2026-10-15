/**
 * "Add a task..." picker on the Edit project page (specs/03 AC-PROJ-015): every active task in the
 * account (the /tasks "Active tasks" list) that isn't already on the project, alphabetical.
 */

export interface PickerTask {
  id: string
  name: string
  archivedAt: Date | null
}

// Case-insensitive with natural number order, so "9. X" < "10. Y" and "accounting" sits with "Admin"
// (Postgres ORDER BY can put every uppercase name before lowercase ones, depending on collation).
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export function compareTaskNames(a: string, b: string): number {
  return collator.compare(a.trim(), b.trim()) || a.localeCompare(b)
}

/** Picker options: active tasks not yet on the project, sorted alphabetically by name. */
export function addableTaskOptions(tasks: readonly PickerTask[], assignedTaskIds: ReadonlySet<string>): { value: string; label: string }[] {
  return tasks
    .filter((t) => t.archivedAt === null && !assignedTaskIds.has(t.id))
    .sort((a, b) => compareTaskNames(a.name, b.name))
    .map((t) => ({ value: t.id, label: t.name }))
}
