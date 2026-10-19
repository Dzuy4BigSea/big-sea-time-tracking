/**
 * The "Track time" modal form Asana renders on a task (specs/29 §1, AC-ASANAAPP-004–008).
 * Pure + DB-free → unit-tested: the route glue loads the state, these functions turn it into Asana's
 * form JSON and turn a submission into a command.
 */
import { parseDurationToMinutes } from '@/modules/shared/duration'

export type What = 'start' | 'log' | 'stop'
export type FieldId = 'what' | 'project' | 'task' | 'notes' | 'hours' | 'date'

export interface Option {
  id: string
  label: string
}

export interface FormValues {
  what: What
  projectId: string | null
  /** Typeahead display text for the chosen project (Asana echoes the whole item back). */
  projectTitle: string | null
  projectSubtitle: string | null
  taskId: string | null
  notes: string
  hours: string
  /** YYYY-MM-DD */
  date: string
}

export interface FormState {
  /** False when the Asana user isn't matched to a Track2 user (AC-ASANAAPP-003). */
  linked: boolean
  /** Where a person links their account (the app's Authentication URL). */
  linkUrl: string
  values: FormValues
  /** Active tasks on the chosen project (empty until one is chosen). */
  tasks: Option[]
  /** The person's running timer, if any. */
  running: { label: string; onThisTask: boolean } | null
  errors?: Partial<Record<FieldId, string>>
  /** Shown at the top (e.g. a refused submit with no single field to blame). */
  formError?: string | null
  urls: { projects: string; change: string; submit: string }
}

// Asana limits (modal-forms reference): label ≤ 50, dropdown ≤ 50 options of label ≤ 80,
// single-line value ≤ 200, multi-line ≤ 3000.
const MAX_OPTIONS = 50
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function whatOptions(running: FormState['running']) {
  const opts: { id: What; label: string; sub_label?: string }[] = [
    { id: 'start', label: 'Start a timer' },
    { id: 'log', label: 'Log hours' },
  ]
  if (running) opts.push({ id: 'stop', label: 'Stop my timer', sub_label: clip(running.label, 80) })
  return opts
}

export interface FormMetadata {
  template: 'form_metadata_v0'
  metadata: { title: string; fields: Record<string, unknown>[]; on_change_callback?: string; on_submit_callback?: string }
}

/** Asana's form_metadata_v0 for the current state. */
export function buildForm(state: FormState): FormMetadata {
  const { values: v, errors = {} } = state
  if (!state.linked) {
    return {
      template: 'form_metadata_v0',
      metadata: {
        title: 'Track time in Track2',
        fields: [
          { id: 'intro', type: 'static_text', name: 'Your Asana account isn’t linked to a Track2 person yet.' },
          { id: 'how', type: 'static_text', name: clip(`Open ${state.linkUrl} while signed in to Track2, then try again.`, 300) },
        ],
        // No on_submit_callback: Asana disables the submit button.
      },
    }
  }

  const what = v.what === 'stop' && !state.running ? 'start' : v.what
  const fields: Record<string, unknown>[] = []
  if (state.formError) fields.push({ id: 'form_error', type: 'static_text', name: clip(state.formError, 300) })
  fields.push({
    id: 'what',
    type: 'radio_button',
    name: 'What',
    is_required: true,
    is_watched: true,
    options: whatOptions(state.running),
    value: what,
    ...(errors.what ? { error: errors.what } : {}),
  })

  if (what !== 'stop') {
    fields.push({
      id: 'project',
      type: 'typeahead',
      name: 'Project',
      is_required: true,
      is_watched: true,
      typeahead_url: state.urls.projects,
      placeholder: 'Search your projects',
      ...(v.projectId ? { value: { title: v.projectTitle ?? 'Project', value: v.projectId, ...(v.projectSubtitle ? { subtitle: v.projectSubtitle } : {}) } } : {}),
      ...(errors.project ? { error: errors.project } : {}),
    })
    if (v.projectId) {
      const options = state.tasks.slice(0, MAX_OPTIONS).map((t) => ({ id: t.id, label: clip(t.label, 80) }))
      const taskValue = options.some((o) => o.id === v.taskId) ? v.taskId : null
      fields.push(
        options.length
          ? { id: 'task', type: 'dropdown', name: 'Task', is_required: true, is_watched: true, options, ...(taskValue ? { value: taskValue } : {}), ...(errors.task ? { error: errors.task } : {}) }
          : { id: 'task_none', type: 'static_text', name: 'This project has no tasks you can track time to.' },
      )
    }
    fields.push({
      id: 'notes',
      type: 'multi_line_text',
      name: 'Notes',
      placeholder: 'Notes (optional)',
      value: clip(v.notes, 3000),
      ...(errors.notes ? { error: errors.notes } : {}),
    })
    if (what === 'log') {
      fields.push(
        { id: 'hours', type: 'single_line_text', name: 'Hours', is_required: true, width: 'half', placeholder: '1.5 or 1:30', value: clip(v.hours, 200), ...(errors.hours ? { error: errors.hours } : {}) },
        { id: 'date', type: 'date', name: 'Date', is_required: true, value: v.date, ...(errors.date ? { error: errors.date } : {}) },
      )
    }
  }

  // Leaving out on_submit_callback disables Submit until the form can succeed.
  const ready = what === 'stop' || (!!v.projectId && state.tasks.some((t) => t.id === v.taskId))
  return {
    template: 'form_metadata_v0',
    metadata: {
      title: 'Track time in Track2',
      fields,
      on_change_callback: state.urls.change,
      ...(ready ? { on_submit_callback: state.urls.submit } : {}),
    },
  }
}

const text = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : String(v))

/** Normalize Asana's `values` (radio/dropdown → id, typeahead → item object, date → ISO). */
export function readValues(raw: Record<string, unknown>, defaults: FormValues): FormValues {
  const out = { ...defaults }
  if ('what' in raw) {
    const w = text(raw.what)
    out.what = w === 'log' || w === 'stop' ? w : 'start'
  }
  if ('project' in raw) {
    const p = raw.project
    if (p && typeof p === 'object') {
      const o = p as Record<string, unknown>
      out.projectId = text(o.value) || null
      out.projectTitle = text(o.title) || null
      out.projectSubtitle = text(o.subtitle) || null
    } else {
      out.projectId = text(p) || null
      out.projectTitle = null
      out.projectSubtitle = null
    }
  }
  if ('task' in raw) out.taskId = text(raw.task) || null
  if ('notes' in raw) out.notes = text(raw.notes)
  if ('hours' in raw) out.hours = text(raw.hours)
  if ('date' in raw) out.date = text(raw.date).slice(0, 10)
  return out
}

/** On a project change the old task no longer applies: pick the first (recently used) task instead. */
export function afterChange(values: FormValues, changedField: string | null, tasks: Option[]): FormValues {
  if (changedField === 'project' || !tasks.some((t) => t.id === values.taskId)) {
    return { ...values, taskId: tasks[0]?.id ?? null }
  }
  return values
}

export type Command =
  | { kind: 'start'; projectId: string; taskId: string; notes: string }
  | { kind: 'log'; projectId: string; taskId: string; notes: string; minutes: number; date: string }
  | { kind: 'stop' }

const MAX_LOG_MINUTES = 24 * 60

function validYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** Validate a submission (AC-ASANAAPP-005–007). Field errors are shown on the re-rendered form. */
export function toCommand(
  v: FormValues,
  ctx: { tasks: Option[]; hasRunningTimer: boolean },
): { ok: true; command: Command } | { ok: false; errors: Partial<Record<FieldId, string>> } {
  if (v.what === 'stop') {
    return ctx.hasRunningTimer ? { ok: true, command: { kind: 'stop' } } : { ok: false, errors: { what: 'No timer is running.' } }
  }
  const errors: Partial<Record<FieldId, string>> = {}
  if (!v.projectId) errors.project = 'Choose a project.'
  else if (!v.taskId || !ctx.tasks.some((t) => t.id === v.taskId)) errors.task = 'Choose a task.'
  const notes = v.notes.trim().slice(0, 3000)
  let minutes = 0
  if (v.what === 'log') {
    const m = parseDurationToMinutes(v.hours)
    if (m == null || m <= 0) errors.hours = 'Enter hours like 1.5 or 1:30.'
    else if (m > MAX_LOG_MINUTES) errors.hours = 'That’s more than 24 hours.'
    else minutes = m
    if (!validYmd(v.date)) errors.date = 'Choose a date.'
  }
  if (Object.keys(errors).length) return { ok: false, errors }
  const base = { projectId: v.projectId as string, taskId: v.taskId as string, notes }
  return v.what === 'log' ? { ok: true, command: { kind: 'log', ...base, minutes, date: v.date } } : { ok: true, command: { kind: 'start', ...base } }
}

/** Tasks for the dropdown: the person's recently used first, then alphabetical (case-insensitive). */
export function orderTasks(tasks: Option[], recentIds: string[]): Option[] {
  const rank = new Map(recentIds.map((id, i) => [id, i]))
  return [...tasks].sort((a, b) => {
    const ra = rank.get(a.id) ?? Infinity
    const rb = rank.get(b.id) ?? Infinity
    if (ra !== rb) return ra - rb
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true })
  })
}
