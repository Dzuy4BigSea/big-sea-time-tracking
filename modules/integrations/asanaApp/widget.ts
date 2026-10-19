/**
 * The Track2 card (widget) Asana shows on a task with a Track2 attachment (specs/29, AC-ASANAAPP-009).
 * Pure + DB-free → unit-tested. Asana limits: 1–5 fields, field name/text ≤ 40 chars, title ≤ 200.
 */
import { formatMinutes, type TimeDisplay } from '@/modules/shared/duration'

export interface WidgetInput {
  /** Minutes on this Asana task the viewer may see (their own, or everyone's). */
  visibleMinutes: number
  /** True when visibleMinutes covers everyone (the viewer can see others' time). */
  everyone: boolean
  ownMinutes: number
  entryCount: number
  /** Who has a timer running on this task (visible to the viewer). */
  runningNames: string[]
  /** Last spent date (YYYY-MM-DD) of a visible entry. */
  lastDate: string | null
  display: TimeDisplay
  now: Date
}

const clip = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const hours = (m: number, d: TimeDisplay) => `${formatMinutes(m, d)}${d === 'decimal' ? ' h' : ''}`

export function buildWidget(w: WidgetInput) {
  const fields: Record<string, unknown>[] = []
  if (w.runningNames.length) {
    const who = w.runningNames.length === 1 ? w.runningNames[0] : `${w.runningNames.length} people`
    fields.push({ type: 'pill', name: 'Timer', text: clip(`Running · ${who}`), color: 'green' })
  } else {
    fields.push({ type: 'pill', name: 'Timer', text: 'Not running', color: 'cool-gray' })
  }
  if (w.everyone) fields.push({ type: 'text_with_icon', name: 'Team total', text: clip(hours(w.visibleMinutes, w.display)) })
  fields.push({ type: 'text_with_icon', name: 'Your time', text: clip(hours(w.ownMinutes, w.display)) })
  if (w.lastDate) fields.push({ type: 'datetime_with_icon', name: 'Last tracked', datetime: `${w.lastDate}T12:00:00.000Z` })

  const total = hours(w.visibleMinutes, w.display)
  return {
    template: 'summary_with_details_v0',
    metadata: {
      title: w.entryCount ? `${total} tracked in Track2` : 'No time tracked in Track2 yet',
      subtitle: w.everyone ? `${w.entryCount} ${w.entryCount === 1 ? 'entry' : 'entries'}` : 'Your time on this task',
      fields: fields.slice(0, 5),
      footer: { footer_type: 'updated', last_updated_at: w.now.toISOString() },
    },
  }
}

/** The widget/attachment resource for an Asana task: a Track2 page listing that task's time. */
export function taskResourceUrl(appUrl: string, taskGid: string): string {
  return `${appUrl.replace(/\/+$/, '')}/asana/t/${encodeURIComponent(taskGid)}`
}

/** The task gid back out of a resource URL Track2 attached (null if it isn't one of ours). */
export function taskGidFromResourceUrl(appUrl: string, resourceUrl: string | null | undefined): string | null {
  if (!resourceUrl) return null
  const prefix = `${appUrl.replace(/\/+$/, '')}/asana/t/`
  if (!resourceUrl.startsWith(prefix)) return null
  const gid = decodeURIComponent(resourceUrl.slice(prefix.length).split(/[?#/]/)[0] ?? '')
  return /^\d{1,32}$/.test(gid) ? gid : null
}
