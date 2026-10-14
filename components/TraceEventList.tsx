import Link from 'next/link'
import { formatDateTimeAt } from '@/lib/format'
import { redact } from '@/modules/observability/invoiceTrace'
import { SOURCE_LABEL, truncateId, type SummaryChip } from '@/modules/observability/invoiceTraceSummary'
import { CopyTextButton } from '@/components/CopyTextButton'

/** Server-rendered list of InvoiceEvents (invoice "Delivery & payment trail" and Settings → Activity log). */
export interface TraceRow {
  id: string
  occurredAt: Date
  stage: string
  source: string
  level: string
  message: string
  externalId: string | null
  httpStatus: number | null
  durationMs: number | null
  detail: unknown
  invoiceId?: string | null
  invoiceNumber?: string | null
}

export const LEVEL_STYLES: Record<string, string> = {
  info: 'bg-gray-100 text-gray-600',
  warn: 'bg-amber-100 text-amber-800',
  error: 'bg-red-100 text-red-700',
}
const LEVEL_DOT: Record<string, string> = { info: 'bg-gray-300', warn: 'bg-amber-500', error: 'bg-red-600' }
const SOURCE_STYLES: Record<string, string> = {
  app: 'border-gray-300 text-gray-600',
  email: 'border-blue-200 text-blue-700',
  client: 'border-purple-200 text-purple-700',
  stripe: 'border-indigo-200 text-indigo-700',
  xero: 'border-teal-200 text-teal-700',
  cron: 'border-gray-200 text-gray-500',
}
const CHIP_TONE: Record<SummaryChip['tone'], string> = {
  ok: 'border-green-200 bg-green-50 text-green-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-700',
  neutral: 'border-gray-200 bg-gray-50 text-gray-600',
}

export function SourceBadge({ source }: { source: string }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${SOURCE_STYLES[source] ?? SOURCE_STYLES.app}`}>
      {SOURCE_LABEL[source] ?? source}
    </span>
  )
}

export function TraceSummaryChips({ chips, timezone }: { chips: SummaryChip[]; timezone: string }) {
  return (
    <div className="mb-3 flex flex-wrap gap-2" data-testid="trace-chips">
      {chips.map((c) => (
        <span key={c.key} className={`rounded-full border px-3 py-1 text-xs ${CHIP_TONE[c.tone]}`}>
          <span className="font-medium">{c.label}:</span> {c.value}
          {c.at && (c.key === 'opened' || c.key === 'stripe' || c.value === 'Delivered') ? ` (${formatDateTimeAt(c.at, timezone)})` : ''}
        </span>
      ))}
    </div>
  )
}

export function TraceEventList({ rows, timezone, showInvoice }: { rows: TraceRow[]; timezone: string; showInvoice?: boolean }) {
  if (!rows.length) return <p className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">No events.</p>
  return (
    <ol className="rounded-lg border border-gray-200 bg-white text-sm" data-testid="trace-events">
      {rows.map((e) => {
        const detail = e.detail == null ? null : JSON.stringify(redact(e.detail), null, 2)
        return (
          <li key={e.id} className="border-b border-gray-100 px-4 py-2.5 last:border-0">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
              <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${LEVEL_DOT[e.level] ?? LEVEL_DOT.info}`} aria-hidden />
              <span className="w-40 flex-none whitespace-nowrap text-xs tabular-nums text-gray-500">{formatDateTimeAt(e.occurredAt, timezone)}</span>
              <SourceBadge source={e.source} />
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${LEVEL_STYLES[e.level] ?? LEVEL_STYLES.info}`}>{e.level}</span>
              <code className="text-xs text-gray-500">{e.stage}</code>
              {showInvoice && e.invoiceId && (
                <Link href={`/invoices/${e.invoiceId}`} className="text-xs text-brand-teal hover:underline">
                  Invoice {e.invoiceNumber ?? '(draft)'}
                </Link>
              )}
              <span className={`min-w-0 flex-1 basis-64 ${e.level === 'error' ? 'text-red-700' : e.level === 'warn' ? 'text-amber-800' : 'text-gray-700'}`}>{e.message}</span>
              <span className="flex flex-none items-center gap-2 text-xs text-gray-400">
                {e.externalId && <CopyTextButton text={e.externalId} label={truncateId(e.externalId)} />}
                {e.httpStatus != null && <span className="tabular-nums">HTTP {e.httpStatus}</span>}
                {e.durationMs != null && <span className="tabular-nums">{e.durationMs} ms</span>}
              </span>
            </div>
            {detail && detail !== '{}' && (
              <details className="ml-5 mt-1">
                <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">Details</summary>
                <pre className="mt-1 max-h-72 overflow-auto rounded bg-gray-50 p-2 text-[11px] leading-snug text-gray-700">{detail}</pre>
              </details>
            )}
          </li>
        )
      })}
    </ol>
  )
}
