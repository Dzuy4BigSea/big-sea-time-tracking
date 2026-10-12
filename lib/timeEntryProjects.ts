/**
 * Pure shaping for the project → task pickers in the shared "New time entry" dialog and the top-bar
 * Timer popover (components/TimeEntryModal.tsx). No DB access, so client components can import it.
 */
import type { ComboOption } from '@/lib/combobox'

export interface TimeEntryProject {
  id: string
  /** Display label, e.g. "[ACM-01] Website" when the project has a code. */
  name: string
  /** Client the project belongs to; the picker groups projects under it (Harvest). */
  clientName: string
  /** Extra searchable text that isn't shown (the project code). */
  code?: string | null
  tasks: { id: string; name: string }[]
}

/** From a loggable project row (lib/timesheetSubject.ts) to the dialog's shape. */
export function toTimeEntryProject(p: {
  id: string
  name: string
  code: string | null
  clientName: string
  tasks: { id: string; name: string }[]
}): TimeEntryProject {
  return { id: p.id, name: p.code ? `[${p.code}] ${p.name}` : p.name, clientName: p.clientName, code: p.code, tasks: p.tasks }
}

/** Project picker options, grouped by client (input order is kept: client, then project). */
export function projectComboOptions(projects: readonly TimeEntryProject[]): ComboOption[] {
  return projects.map((p) => ({ value: p.id, label: p.name, group: p.clientName, keywords: p.code ?? undefined }))
}

/** Task picker options for the chosen project (ungrouped). */
export function taskComboOptions(projects: readonly TimeEntryProject[], projectId: string): ComboOption[] {
  return (projects.find((p) => p.id === projectId)?.tasks ?? []).map((t) => ({ value: t.id, label: t.name }))
}

/** The task preselected for a project: its first task, as a native <select> would (or none). */
export function defaultTaskId(projects: readonly TimeEntryProject[], projectId: string): string {
  return projects.find((p) => p.id === projectId)?.tasks[0]?.id ?? ''
}
