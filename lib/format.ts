/** Presentation helpers. Money is stored as integer cents; format for display only. */

export function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

/**
 * MM/DD/YYYY. Formatted in UTC: date-only columns (`@db.Date`) are stored and read back as UTC
 * midnight, so formatting in the machine's local zone would show the previous day west of UTC
 * (e.g. on a browser or a dev box in America/New_York).
 */
export function formatDate(d: Date | null): string {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(d)
}

/** A moment in the account's timezone, Harvest's activity style: "09/23/2026 at 11:37am". */
export function formatDateTimeAt(d: Date, timeZone: string): string {
  let tz = timeZone
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
  } catch {
    tz = 'America/New_York'
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: tz,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('month')}/${get('day')}/${get('year')} at ${get('hour')}:${get('minute')}${get('dayPeriod').toLowerCase()}`
}
