'use client'

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { importBatchAction } from '@/app/settings/migrate/actions'
import type { EntityTally, ImportBatchResult, ImportCursor } from '@/modules/migration/importer'

type Props = {
  snapshotId: string | null
  snapshotStatus: string | null
  totalRows: number
}

const ENTITY_ORDER = ['client', 'contact', 'task', 'user', 'expense_category', 'project', 'time_entry', 'expense', 'invoice', 'invoice_payment', 'estimate']
const ENTITY_LABEL: Record<string, string> = {
  client: 'Clients', contact: 'Contacts', task: 'Tasks', user: 'People', expense_category: 'Expense categories',
  project: 'Projects', time_entry: 'Time entries', expense: 'Expenses', invoice: 'Invoices', invoice_payment: 'Payments', estimate: 'Estimates',
}

const emptyTally = (): EntityTally => ({ created: 0, updated: 0, skipped: 0, errors: 0 })

export function ImportRunner({ snapshotId, snapshotStatus, totalRows }: Props) {
  const router = useRouter()
  const [totals, setTotals] = useState<Record<string, EntityTally>>({})
  const [processed, setProcessed] = useState(0)
  const [active, setActive] = useState(false)
  const [mode, setMode] = useState<'idle' | 'preview' | 'apply'>('idle')
  const [stageLabel, setStageLabel] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [previewedOk, setPreviewedOk] = useState(false)
  const stopRef = useRef(false)

  const run = useCallback(
    async (dryRun: boolean) => {
      if (!snapshotId) return
      setActive(true)
      setError(null)
      setNotes([])
      setMode(dryRun ? 'preview' : 'apply')
      setTotals({})
      setProcessed(0)
      stopRef.current = false

      const acc: Record<string, EntityTally> = {}
      let proc = 0
      let cursor: ImportCursor | null = null
      // eslint-disable-next-line no-constant-condition
      while (true) {
        let res: ImportBatchResult
        try {
          res = await importBatchAction({ snapshotId, dryRun, cursor })
        } catch (e) {
          setError((e as Error).message || 'Import batch failed — press the button to resume.')
          break
        }
        if (!res.ok) {
          setError(res.message ?? 'Import could not run.')
          break
        }
        for (const [entity, t] of Object.entries(res.batch)) {
          const cur = (acc[entity] ??= emptyTally())
          cur.created += t.created
          cur.updated += t.updated
          cur.skipped += t.skipped
          cur.errors += t.errors
        }
        proc += res.processedThisBatch
        setTotals({ ...acc })
        setProcessed(proc)
        setStageLabel(res.stageLabel)
        if (res.notes.length) setNotes((n) => [...n, ...res.notes].slice(0, 20))
        if (res.done || stopRef.current) break
        cursor = res.cursor
      }
      setActive(false)
      if (!dryRun) {
        setPreviewedOk(false) // force a fresh preview before another apply
        router.refresh()
      } else {
        setPreviewedOk(true)
      }
    },
    [snapshotId, router],
  )

  if (!snapshotId) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-500">
        Capture a backup first (step 2). Once a snapshot is complete, you can preview and import it here.
      </div>
    )
  }

  const pct = totalRows > 0 ? Math.min(100, Math.round((processed / totalRows) * 100)) : active ? 3 : 0
  const totalErrors = Object.values(totals).reduce((a, t) => a + t.errors, 0)
  const rowEntities = ENTITY_ORDER.filter((e) => e in totals)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <p className="mb-3 text-sm text-gray-600">
        Transforms the backup snapshot into Track2 records — clients, people, projects, tasks, time, expenses,
        invoices, and estimates — keyed by Harvest IDs so it is <strong>idempotent</strong> and safe to re-run.
        Always <strong>preview</strong> first (a dry run that writes nothing), review the plan, then apply.
        {snapshotStatus === 'partial' && (
          <span className="mt-1 block text-amber-600">
            Note: the newest snapshot finished with some gaps (status “partial”). You can still import it, but
            consider re-running the backup for a complete capture first.
          </span>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={active}
          onClick={() => run(true)}
          className="rounded border border-brand-teal px-4 py-1.5 text-sm font-medium text-brand-teal hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {active && mode === 'preview' ? 'Previewing…' : 'Preview import (dry run)'}
        </button>
        <button
          disabled={active || !previewedOk}
          title={!previewedOk ? 'Run a preview first' : ''}
          onClick={() => {
            if (window.confirm('Apply the import? This writes clients, projects, people, time, expenses and invoices into Track2. It is idempotent, so re-running is safe.')) run(false)
          }}
          className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {active && mode === 'apply' ? 'Importing…' : 'Apply import'}
        </button>
        {active && (
          <button
            onClick={() => { stopRef.current = true }}
            className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Pause
          </button>
        )}
      </div>

      {(active || processed > 0) && (
        <div className="mt-4">
          <div className="mb-1 flex items-baseline justify-between text-xs text-gray-500">
            <span className="inline-flex items-center gap-2">
              {active && <span className={`h-2 w-2 animate-pulse rounded-full ${mode === 'apply' ? 'bg-brand-green' : 'bg-brand-teal'}`} />}
              {mode === 'preview' ? 'Preview' : 'Import'}{stageLabel ? ` · ${stageLabel}` : ''} — {processed.toLocaleString()} of {totalRows.toLocaleString()} rows
            </span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full transition-all duration-500 ${totalErrors ? 'bg-amber-500' : mode === 'apply' ? 'bg-brand-green' : 'bg-brand-teal'}`}
              style={{ width: `${pct}%` }}
            />
          </div>

          {rowEntities.length > 0 && (
            <table className="mt-3 w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400">
                  <th className="py-1 font-medium">Entity</th>
                  <th className="py-1 text-right font-medium">Created</th>
                  <th className="py-1 text-right font-medium">Updated</th>
                  <th className="py-1 text-right font-medium">Skipped</th>
                  <th className="py-1 text-right font-medium">Errors</th>
                </tr>
              </thead>
              <tbody>
                {rowEntities.map((e) => (
                  <tr key={e} className="border-t border-gray-100">
                    <td className="py-1 text-gray-600">{ENTITY_LABEL[e] ?? e}</td>
                    <td className="py-1 text-right tabular-nums text-gray-800">{totals[e].created.toLocaleString()}</td>
                    <td className="py-1 text-right tabular-nums text-gray-500">{totals[e].updated.toLocaleString()}</td>
                    <td className="py-1 text-right tabular-nums text-gray-400">{totals[e].skipped.toLocaleString()}</td>
                    <td className={`py-1 text-right tabular-nums ${totals[e].errors ? 'text-red-600' : 'text-gray-300'}`}>{totals[e].errors.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!active && mode === 'preview' && processed > 0 && !error && (
        <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-brand-teal">
          Preview complete — nothing was written. Review the counts above, then <strong>Apply import</strong> to write them into Track2.
        </div>
      )}
      {!active && mode === 'apply' && processed > 0 && !error && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-brand-green">
          Import complete{totalErrors ? ` with ${totalErrors} error${totalErrors === 1 ? '' : 's'}` : ''}. Data is now in Track2 — re-running is safe (idempotent).
        </div>
      )}

      {notes.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-amber-600">{notes.length} issue{notes.length === 1 ? '' : 's'} logged</summary>
          <ul className="mt-1 space-y-0.5 text-[11px] text-gray-500">
            {notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </details>
      )}

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    </div>
  )
}
