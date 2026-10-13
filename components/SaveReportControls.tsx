'use client'

import { useCallback, useState } from 'react'
import { DropdownMenu } from '@/components/DropdownMenu'
import { SaveReportDialog } from '@/components/SaveReportDialog'
import { updateSavedReportParams } from '@/app/reports/saved/actions'
import type { SavedReportKind } from '@/modules/reports/savedReports'

/**
 * Right-hand report toolbar control (Harvest): "Save report" on an unsaved report; on an opened saved
 * report, a menu named after it with Edit / Update existing report (only when the view has changed) /
 * Save as new report. Non-owners of a shared report only get "Save as new report".
 */
export function SaveReportControls({
  kind,
  params,
  saved,
}: {
  kind: SavedReportKind
  /** The report's current URL params (what would be saved). */
  params: Record<string, string>
  saved?: { id: string; name: string; shared: boolean; canEdit: boolean; changed: boolean } | null
}) {
  const [dialog, setDialog] = useState<'create' | 'edit' | null>(null)
  const close = useCallback(() => setDialog(null), [])
  const btn = 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 shadow-sm hover:bg-gray-50'
  const item = 'block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent'

  return (
    <>
      {saved ? (
        <DropdownMenu
          label={
            <span className="flex max-w-[16rem] items-center gap-2 font-medium">
              <span className="truncate">{saved.name}</span>
              <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
          }
          summaryClassName={`cursor-pointer list-none ${btn}`}
          menuClassName="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-left shadow-lg"
        >
          {saved.canEdit && (
            <>
              <button type="button" className={item} onClick={() => setDialog('edit')}>Edit</button>
              <form action={updateSavedReportParams}>
                <input type="hidden" name="id" value={saved.id} />
                <input type="hidden" name="params" value={JSON.stringify(params)} />
                <button type="submit" disabled={!saved.changed} className={item}>Update existing report</button>
              </form>
            </>
          )}
          <button type="button" className={item} onClick={() => setDialog('create')}>Save as new report</button>
        </DropdownMenu>
      ) : (
        <button type="button" className={btn} onClick={() => setDialog('create')}>
          Save report
        </button>
      )}
      {dialog === 'create' && <SaveReportDialog mode="create" kind={kind} params={params} open onClose={close} />}
      {dialog === 'edit' && saved && <SaveReportDialog mode="edit" report={saved} open onClose={close} />}
    </>
  )
}
