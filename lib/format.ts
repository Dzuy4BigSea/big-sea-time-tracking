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
