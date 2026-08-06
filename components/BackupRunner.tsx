'use client'

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { backupBatchAction, type BackupProgress } from '@/app/settings/migrate/actions'

type Props = {
  connected: boolean
  hasCompleteBackup: boolean
  /** an in-flight snapshot found on the server, if any */
  running: { id: string; done: number; total: number; rows: number } | null
}

const RESOURCE_ORDER = [
  'clients', 'contacts', 'projects', 'tasks', 'users', 'roles', 'expense_categories', 'estimates',
  'time_entries', 'expenses', 'invoices',
]

export function BackupRunner({ connected, hasCompleteBackup, running }: Props) {
  const router = useRouter()
  const [progress, setProgress] = useState<BackupProgress | null>(
    running ? { ok: true, snapshotId: running.id, status: 'running', done: running.done, total: running.total, rows: running.rows, mode: 'full' } : null,
  )
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A ref the running loop checks each iteration so "Pause" can stop it cleanly.
  const stopRef = useRef(false)

  const drive = useCallback(
    async (first: { snapshotId?: string; mode?: string }) => {
      setActive(true)
      setError(null)
      stopRef.current = false
      let next: { snapshotId?: string; mode?: string } = first
      // Loop one batch at a time until the backup is no longer "running" (or the user pauses).
      // Each batch is a fresh server round-trip, so this survives the serverless per-request cap.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        let res: BackupProgress
        try {
          res = await backupBatchAction(next)
        } catch (e) {
          setError((e as Error).message || 'Backup batch failed — press Resume to retry.')
          break
        }
        if (!res.ok) {
          setError(res.message ?? 'Backup could not run.')
          break
        }
        setProgress(res)
        if (res.status !== 'running' || stopRef.current) break
        next = { snapshotId: res.snapshotId } // continue the same snapshot
      }
      setActive(false)
      router.refresh() // refresh the snapshot table + import step below
    },
    [router],
  )

  const done = progress?.done ?? running?.done ?? 0
  const total = progress?.total ?? running?.total ?? 0
  const pct = total > 0 ? Math.round((done / total) * 100) : active ? 3 : 0
  const rows = progress?.rows ?? running?.rows ?? 0
  const status = progress?.status
  const counts = progress?.counts ?? {}
  const errorKeys = progress?.errorKeys ?? []

  const showBar = active || (status && status !== 'complete') || (running && !progress)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <p className="mb-3 text-sm text-gray-600">
        Pulls every Harvest record (clients, contacts, projects, tasks, people, time, expenses, invoices, estimates)
        and stores an immutable JSON snapshot you can download and keep. Run this first — it does not change anything.
        It works in <strong>resumable batches</strong> and continues automatically until every year is captured;
        already-captured data is never re-pulled, so it is safe to pause and resume.
      </p>
      <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
        <strong>Very large accounts (many years, tens of thousands of time entries):</strong> a single
        year can exceed the server request limit here and stall. If the bar stops advancing, run the
        one-time offline backup instead (<code>scripts/backup-harvest-offline.mjs</code>, see
        MIGRATION-RUNBOOK.md) — then use <em>Incremental</em> for the quick delta pulls, which always work here.
      </p>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {!active && status !== 'running' && (
          <>
            <button
              disabled={!connected}
              onClick={() => drive({ mode: 'full' })}
              className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === 'complete' || status === 'partial' ? 'Run another full backup' : 'Full backup'}
            </button>
            <button
              disabled={!connected || !hasCompleteBackup}
              onClick={() => drive({ mode: 'incremental' })}
              title={!hasCompleteBackup ? 'Run a full backup first' : ''}
              className="rounded border border-brand-green px-4 py-1.5 text-sm font-medium text-brand-green hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Incremental (delta since last)
            </button>
          </>
        )}

        {/* Resume a snapshot that was left running (e.g. page reloaded mid-backup) */}
        {!active && status === 'running' && (
          <button
            onClick={() => drive({ snapshotId: progress?.snapshotId })}
            className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            Resume &amp; finish
          </button>
        )}

        {active && (
          <button
            onClick={() => {
              stopRef.current = true
            }}
            className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Pause
          </button>
        )}

        {!connected && <span className="text-xs text-gray-400">Connect Harvest first.</span>}
      </div>

      {/* Live progress */}
      {showBar && (
        <div className="mt-4">
          <div className="mb-1 flex items-baseline justify-between text-xs text-gray-500">
            <span>
              {active ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-brand-green" />
                  Capturing… {done} of {total || '—'} parts
                </span>
              ) : status === 'partial' ? (
                <span className="text-amber-600">Finished with {errorKeys.length} issue{errorKeys.length === 1 ? '' : 's'} — {done} of {total} parts</span>
              ) : status === 'running' ? (
                <span className="text-amber-600">Paused — {done} of {total} parts captured</span>
              ) : (
                <>{done} of {total} parts</>
              )}
            </span>
            <span className="tabular-nums">{rows.toLocaleString()} rows</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full transition-all duration-500 ${status === 'partial' ? 'bg-amber-500' : 'bg-brand-green'}`}
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Per-resource captured counts */}
          {Object.keys(counts).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {RESOURCE_ORDER.filter((r) => r in counts).map((r) => (
                <span key={r} className="rounded bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">
                  {r.replace(/_/g, ' ')} <span className="font-medium text-gray-800 tabular-nums">{counts[r].toLocaleString()}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {status === 'complete' && !active && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-brand-green">
          Backup complete — {rows.toLocaleString()} rows across {total} parts captured. Download it below, then run the import.
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  )
}
