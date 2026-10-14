import type { BannerKind } from '@/modules/invoicing/statusBanner'

/**
 * Harvest-style rubber stamp over the invoice document ("LATE", "PAID", …), replacing the old
 * status bar. Status words and colors follow Harvest (AC-UI-003): gray Draft, blue Sent, red Late,
 * green Paid; muted for written off / closed. Decorative: the status is also exposed to assistive
 * tech via the aria-label.
 */
const STAMP: Record<BannerKind, { label: string; color: string }> = {
  draft: { label: 'Draft', color: '#6b7280' },
  sent: { label: 'Sent', color: '#2563eb' },
  late: { label: 'Late', color: '#c0392b' },
  paid: { label: 'Paid', color: '#2e7d32' },
  written_off: { label: 'Written off', color: '#6b7280' },
  closed: { label: 'Closed', color: '#6b7280' },
}

export function InvoiceStamp({ kind, title }: { kind: BannerKind; title?: string }) {
  const s = STAMP[kind]
  return (
    <div
      role="img"
      aria-label={`Status: ${s.label}`}
      title={title}
      className="pointer-events-none select-none whitespace-nowrap rounded-sm px-3 py-0.5 font-serif text-3xl font-bold uppercase tracking-[0.12em] opacity-80"
      style={{
        color: s.color,
        border: `3px solid ${s.color}`,
        boxShadow: `inset 0 0 0 2px #fff, inset 0 0 0 3.5px ${s.color}`,
        transform: 'rotate(-12deg)',
      }}
    >
      {s.label}
    </div>
  )
}
