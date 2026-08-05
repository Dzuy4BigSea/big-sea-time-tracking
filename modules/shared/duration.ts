/**
 * Duration helpers. Time is stored as integer minutes; decimal hours are presentation-only.
 * See specs/04-time-tracking.md.
 */

export type TimeRounding =
  | 'none'
  | 'nearest_1'
  | 'nearest_5'
  | 'nearest_6'
  | 'nearest_10'
  | 'nearest_15'

export type TimeDisplay = 'hh_mm' | 'decimal'

const INCREMENT: Record<TimeRounding, number> = {
  none: 0,
  nearest_1: 1,
  nearest_5: 5,
  nearest_6: 6,
  nearest_10: 10,
  nearest_15: 15,
}

/**
 * Parse a user-typed duration into minutes. Accepts (AC-TIME-005):
 *   "1:30"  -> 90   (H:MM)
 *   "1.5"   -> 90   (decimal hours)
 *   "90m"   -> 90   (explicit minutes)
 *   "2"     -> 120  (bare number = decimal hours, matching Harvest)
 *   "1h30m" -> 90   (compound)
 * Returns null if unparseable.
 */
export function parseDurationToMinutes(raw: string): number | null {
  const s = raw.trim().toLowerCase()
  if (s === '') return null

  // H:MM
  const clock = /^(\d+):([0-5]?\d)$/.exec(s)
  if (clock) return parseInt(clock[1], 10) * 60 + parseInt(clock[2], 10)

  // compound like "1h30m", "1h", "45m"
  const compound = /^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+)m)?$/.exec(s)
  if (compound && (compound[1] != null || compound[2] != null)) {
    const hours = compound[1] != null ? parseFloat(compound[1]) : 0
    const mins = compound[2] != null ? parseInt(compound[2], 10) : 0
    return Math.round(hours * 60) + mins
  }

  // bare decimal = hours
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 60)

  return null
}

/** Round minutes to the account's increment; ties up. Summary/timer layer only (never stored raw). */
export function applyRounding(minutes: number, rounding: TimeRounding): number {
  const inc = INCREMENT[rounding]
  if (!inc) return minutes
  return Math.round(minutes / inc) * inc
}

/** Format minutes for display. hh_mm -> "1:30"; decimal -> "1.50". */
export function formatMinutes(minutes: number, display: TimeDisplay = 'hh_mm'): string {
  if (display === 'decimal') return (minutes / 60).toFixed(2)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}:${String(m).padStart(2, '0')}`
}
