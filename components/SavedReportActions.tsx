'use client'

import { useCallback, useState } from 'react'
import { DropdownMenu } from '@/components/DropdownMenu'
import { SaveReportDialog } from '@/components/SaveReportDialog'
import { deleteSavedReport, duplicateSavedReport, setSavedReportArchived } from '@/app/reports/saved/actions'

/** Row "Actions ⌄" on Saved reports (Harvest: Edit / Duplicate / Delete; plus Archive / Restore). */
export function SavedReportActions({
  report,
  canEdit,
}: {
  report: { id: string; name: string; shared: boolean; archived: boolean }
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(false)
  const close = useCallback(() => setEditing(false), [])
  const item = 'block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50'
  return (
    <>
      <DropdownMenu
        label={
          <span className="flex items-center gap-1">
            Actions
            <svg aria-hidden width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        }
        summaryClassName="cursor-pointer list-none rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
        menuClassName="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-left shadow-lg"
      >
        {canEdit && (
          <button type="button" className={item} onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        <form action={duplicateSavedReport}>
          <input type="hidden" name="id" value={report.id} />
          <button type="submit" className={item}>Duplicate</button>
        </form>
        {canEdit && (
          <>
            <form action={setSavedReportArchived}>
              <input type="hidden" name="id" value={report.id} />
              <input type="hidden" name="archived" value={report.archived ? '0' : '1'} />
              <button type="submit" className={item}>{report.archived ? 'Restore' : 'Archive'}</button>
            </form>
            <div className="my-1 border-t border-gray-100" />
            <form
              action={deleteSavedReport}
              onSubmit={(e) => {
                if (!confirm(`Delete the saved report "${report.name}"? This can't be undone.`)) e.preventDefault()
              }}
            >
              <input type="hidden" name="id" value={report.id} />
              <button type="submit" className={`${item} text-red-600`}>Delete</button>
            </form>
          </>
        )}
      </DropdownMenu>
      {editing && <SaveReportDialog mode="edit" report={report} open onClose={close} />}
    </>
  )
}
