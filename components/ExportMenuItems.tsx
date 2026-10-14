'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { DRIVE_RESULT_PARAMS } from '@/modules/integrations/googleDriveShared'

/** The page to come back to after a Drive action: the current URL minus earlier Drive result params. */
function useReturnTo(): string {
  const pathname = usePathname() ?? '/'
  const sp = new URLSearchParams(useSearchParams()?.toString() ?? '')
  for (const k of DRIVE_RESULT_PARAMS) sp.delete(k)
  const q = sp.toString()
  return q ? `${pathname}?${q}` : pathname
}

const itemClass = 'block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50'

/**
 * "Google Drive" item: a same-origin form POST (state-changing, so not a link) carrying the CSV href
 * of the same export. The server maps it to the export and re-checks permissions.
 */
export function DriveExportItem({ exportHref }: { exportHref: string }) {
  const returnTo = useReturnTo()
  return (
    <form method="post" action="/api/google/drive/export">
      <input type="hidden" name="exportHref" value={exportHref} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button type="submit" className={itemClass}>
        Google Drive
      </button>
    </form>
  )
}

export function DriveDisconnectItem({ googleEmail }: { googleEmail: string }) {
  const returnTo = useReturnTo()
  return (
    <form method="post" action="/api/google/drive/disconnect" className="mt-1 border-t border-gray-100 px-3 pb-1 pt-1.5 text-xs text-gray-400">
      <input type="hidden" name="returnTo" value={returnTo} />
      <span className="block truncate" title={googleEmail}>
        Google Drive: connected
      </span>
      <button type="submit" className="text-brand-teal hover:underline">
        Disconnect
      </button>
    </form>
  )
}
