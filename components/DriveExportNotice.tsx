'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { DRIVE_RESULT_PARAMS, driveErrorMessage, isDriveFileId, sheetUrl } from '@/modules/integrations/googleDriveShared'

/**
 * Result banner after "Export → Google Drive" (or connect/disconnect): reads ?driveFile= / ?driveError= /
 * ?drive= that /api/google/drive/* append to the page they return to. The Sheet link is rebuilt from a
 * validated file id, never taken as a URL from the query string. Rendered once in the root layout.
 */
export function DriveExportNotice() {
  const sp = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const fileId = sp?.get('driveFile')
  const error = driveErrorMessage(sp?.get('driveError'))
  const status = sp?.get('drive')
  const info = status === 'connected' ? 'Google Drive connected.' : status === 'disconnected' ? 'Google Drive disconnected.' : null
  const okFile = isDriveFileId(fileId) ? fileId : null
  if (!okFile && !error && !info) return null

  const dismiss = () => {
    const q = new URLSearchParams(sp?.toString() ?? '')
    for (const k of DRIVE_RESULT_PARAMS) q.delete(k)
    const s = q.toString()
    router.replace(s ? `${pathname}?${s}` : pathname ?? '/', { scroll: false })
  }

  const tone = error ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'
  return (
    <div role="status" className={`mb-4 flex items-start justify-between gap-3 rounded-lg border px-4 py-2 text-sm ${tone}`}>
      <span>
        {okFile ? (
          <>
            Saved to your Google Drive ·{' '}
            <a href={sheetUrl(okFile)} target="_blank" rel="noopener noreferrer" className="font-medium underline">
              Open spreadsheet
            </a>
          </>
        ) : (
          (error ?? info)
        )}
      </span>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100">
        ×
      </button>
    </div>
  )
}
