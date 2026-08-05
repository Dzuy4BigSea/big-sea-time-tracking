/** UTC week helpers (week starts Monday, matching the account default). */

export function startOfWeekMonday(d: Date): Date {
  const day = d.getUTCDay() // 0=Sun .. 6=Sat
  const sinceMonday = (day + 6) % 7
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday))
}

export function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n))
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Parse a YYYY-MM-DD string to a UTC-midnight Date, or null. */
export function parseYmd(s: string | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  return isNaN(d.getTime()) ? null : d
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate()
}
