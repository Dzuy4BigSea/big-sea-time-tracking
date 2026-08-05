/** Presentation helpers. Money is stored as integer cents; format for display only. */

export function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

export function formatDate(d: Date | null): string {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }).format(d)
}
