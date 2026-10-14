/**
 * Unit conversion at the API boundary. Storage stays integer minutes and integer cents (INV-1);
 * decimal hours / currency amounts exist only in requests and responses, like Harvest's API.
 */
import { invalid } from './errors'
import { applyRounding, type TimeRounding } from '@/modules/shared/duration'

/** Minutes → decimal hours, 2 places (Harvest's `hours`). */
export function hoursOf(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100
}

/** Decimal hours → whole minutes. Track2 stores minutes, so the smallest loggable value is 1 minute. */
export function minutesFromHours(hours: number, field = 'hours'): number {
  if (!Number.isFinite(hours) || hours <= 0) throw invalid(`${field}: must be greater than 0 (use delete_time_entry to remove an entry).`, { field })
  const m = Math.round(hours * 60)
  if (m <= 0) throw invalid(`${field}: ${hours} rounds to 0 minutes; Track2 stores whole minutes (minimum 0.02 h).`, { field })
  if (m > 24 * 60) throw invalid(`${field}: cannot exceed 24 hours in one entry.`, { field })
  return m
}

/** Hours under the account rounding rule, or undefined when the account doesn't round (Harvest omits it then). */
export function roundedHoursOf(minutes: number, rounding: string): number | undefined {
  if (!rounding || rounding === 'none') return undefined
  return hoursOf(applyRounding(minutes, rounding as TimeRounding))
}

/** Parse a clock time ("9:00am", "9am", "14:30", "2:05 PM") to minutes after midnight, or null. */
export function parseClock(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '')
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm|a|p)?$/.exec(s)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  const ampm = m[3]
  if (min > 59) return null
  if (ampm) {
    if (h < 1 || h > 12) return null
    const pm = ampm.startsWith('p')
    if (h === 12) h = pm ? 12 : 0
    else if (pm) h += 12
  } else if (h > 23 || (!m[2] && !ampm)) {
    // A bare "9" is ambiguous as a clock time; require "9:00" or "9am".
    return null
  }
  return h * 60 + min
}

/**
 * Duration from `started_time` + `ended_time`, in minutes. Track2 stores durations only (no clock-in /
 * clock-out columns), like a Harvest decimal-hours account: the interval is derived into minutes.
 */
export function minutesFromClockPair(started?: string, ended?: string): number {
  if (!started || !ended) throw invalid('started_time and ended_time must be given together.', { field: started ? 'ended_time' : 'started_time' })
  const a = parseClock(started)
  const b = parseClock(ended)
  if (a == null) throw invalid(`started_time: "${started}" is not a time like "9:00am" or "14:30".`, { field: 'started_time' })
  if (b == null) throw invalid(`ended_time: "${ended}" is not a time like "11:00am" or "16:00".`, { field: 'ended_time' })
  if (b <= a) throw invalid('ended_time must be after started_time (same day).', { field: 'ended_time' })
  return b - a
}

/** Exactly one of hours / (started_time + ended_time) → minutes. `required` = one must be present. */
export function durationMinutes(
  args: { hours?: number; started_time?: string; ended_time?: string },
  required: boolean,
): number | undefined {
  const hasClock = args.started_time !== undefined || args.ended_time !== undefined
  if (args.hours !== undefined && hasClock) throw invalid('Provide hours OR started_time + ended_time, not both.', { field: 'hours' })
  if (args.hours !== undefined) return minutesFromHours(args.hours)
  if (hasClock) return minutesFromClockPair(args.started_time, args.ended_time)
  if (required) throw invalid('Provide hours (e.g. 1.5) or started_time + ended_time.', { field: 'hours' })
  return undefined
}

/** Currency amount from a request (decimal) → integer cents (INV-1). */
export function centsFromAmount(amount: number, field: string, opts: { allowZero?: boolean; allowNegative?: boolean } = {}): number {
  if (!Number.isFinite(amount)) throw invalid(`${field}: must be a number.`, { field })
  if (!opts.allowNegative && amount < 0) throw invalid(`${field}: must not be negative.`, { field })
  if (!opts.allowZero && amount === 0) throw invalid(`${field}: must be greater than 0.`, { field })
  return Math.round(amount * 100)
}

/** Integer cents → decimal amount for responses. */
export function amountOf(cents: number | null | undefined): number | null {
  return cents == null ? null : cents / 100
}

export const ymdOf = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null)

/** Harvest payment_term phrases → Track2 PaymentTerm. */
export function paymentTermFrom(raw: string): 'due_on_receipt' | 'net_15' | 'net_30' | 'net_45' | 'net_60' {
  const s = raw.trim().toLowerCase().replace(/[\s_-]+/g, ' ')
  if (/^(upon|due on) receipt$/.test(s)) return 'due_on_receipt'
  const m = /^net (15|30|45|60)$/.exec(s)
  if (m) return `net_${m[1]}` as 'net_15' | 'net_30' | 'net_45' | 'net_60'
  throw invalid(`payment_term: "${raw}" is not supported — use "upon receipt", "net 15", "net 30", "net 45" or "net 60", or pass due_date.`, { field: 'payment_term' })
}

/** Days for a payment term (mirrors invoiceLifecycle's TERM_DAYS). */
export const TERM_DAYS: Record<string, number> = { due_on_receipt: 0, net_15: 15, net_30: 30, net_45: 45, net_60: 60, custom: 30 }

/** Track2 invoice status + dates → Harvest `state` (draft/open/paid/closed) and `display_status`. */
export function harvestInvoiceState(status: string): 'draft' | 'open' | 'paid' | 'closed' {
  if (status === 'draft') return 'draft'
  if (status === 'paid') return 'paid'
  if (status === 'open') return 'open'
  return 'closed' // written_off / closed
}
