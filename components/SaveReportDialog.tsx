'use client'

import { useEffect, useRef } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { createSavedReport, editSavedReport, type SaveReportState } from '@/app/reports/saved/actions'
import type { SavedReportKind } from '@/modules/reports/savedReports'

/**
 * Harvest's "Save report" dialog: Report name + Permissions ("Don't share this report" / "Share with
 * team"). `mode="create"` saves the current report (kind + params) as a new saved report and opens it;
 * `mode="edit"` renames / re-shares an existing one. The trigger is rendered by the caller via `open`.
 */
export function SaveReportDialog({
  mode,
  kind,
  params,
  report,
  open,
  onClose,
}: {
  mode: 'create' | 'edit'
  kind?: SavedReportKind
  params?: Record<string, string>
  report?: { id: string; name: string; shared: boolean }
  open: boolean
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [state, action] = useFormState<SaveReportState, FormData>(mode === 'create' ? createSavedReport : editSavedReport, {})
  const submitted = useRef(false)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  // Edit returns {} on success (create redirects): close once a submit comes back without an error.
  useEffect(() => {
    if (submitted.current && !state.error) {
      submitted.current = false
      onClose()
    }
  }, [state, onClose])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose() // backdrop click
      }}
      className="w-[min(92vw,26rem)] rounded-lg border border-gray-200 p-0 shadow-xl backdrop:bg-black/30"
    >
      <form
        action={(fd) => {
          submitted.current = true
          return action(fd)
        }}
        className="text-sm"
      >
        <div className="border-b border-gray-200 px-5 py-3 text-center font-semibold text-gray-900">{mode === 'create' ? 'Save report' : 'Edit report'}</div>
        <div className="space-y-4 px-5 py-4">
          {mode === 'create' ? (
            <>
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="params" value={JSON.stringify(params ?? {})} />
            </>
          ) : (
            <input type="hidden" name="id" value={report?.id} />
          )}
          <label className="block">
            <span className="mb-1 block font-semibold text-gray-800">Report name</span>
            <input
              name="name"
              required
              maxLength={200}
              defaultValue={mode === 'edit' ? report?.name : ''}
              autoFocus
              className="w-full rounded border border-gray-300 px-2 py-1.5"
            />
          </label>
          <fieldset>
            <legend className="mb-1 font-semibold text-gray-800">Permissions</legend>
            <label className="flex items-center gap-2 py-0.5 text-gray-700">
              <input type="radio" name="shared" value="0" defaultChecked={!report?.shared} /> Don&apos;t share this report
            </label>
            <label className="flex items-center gap-2 py-0.5 text-gray-700">
              <input type="radio" name="shared" value="1" defaultChecked={!!report?.shared} /> Share with team
            </label>
            <p className="mt-1 text-xs text-gray-500">Shared reports appear under &ldquo;Reports shared with me&rdquo; for everyone on the account.</p>
          </fieldset>
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        </div>
        <div className="flex gap-2 border-t border-gray-200 px-5 py-3">
          <SubmitButton label={mode === 'create' ? 'Save report' : 'Save changes'} />
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 bg-white px-4 py-1.5 text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  )
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="rounded-md bg-brand-green px-4 py-1.5 font-semibold text-white hover:opacity-90 disabled:opacity-60">
      {pending ? 'Saving…' : label}
    </button>
  )
}
