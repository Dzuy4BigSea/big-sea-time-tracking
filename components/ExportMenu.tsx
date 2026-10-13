import { DropdownMenu } from '@/components/DropdownMenu'
import { DriveDisconnectItem, DriveExportItem } from '@/components/ExportMenuItems'
import { getCurrentUser } from '@/lib/session'
import { getGrantStatus, isDriveExportEnabled } from '@/lib/googleDrive'

/**
 * "Export ▾" (Harvest): CSV download, plus "Google Drive" when Google OAuth + INTEGRATION_ENC_KEY are
 * configured (OPS.md §8). `csvHref` is the existing CSV export link; the Drive item sends that same
 * href to /api/google/drive/export, which builds the identical CSV and saves it as a new Sheet.
 * Without the Google env vars this renders a menu with just CSV.
 */
export async function ExportMenu({ csvHref, summaryClassName }: { csvHref: string; summaryClassName?: string }) {
  const drive = isDriveExportEnabled()
  const me = drive ? await getCurrentUser() : null
  const grant = me ? await getGrantStatus(me).catch(() => null) : null
  return (
    <DropdownMenu
      label={<>Export ▾</>}
      summaryClassName={
        summaryClassName ?? 'cursor-pointer list-none rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50'
      }
      menuClassName="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-left shadow-lg"
    >
      <a href={csvHref} className="block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
        CSV
      </a>
      {drive && <DriveExportItem exportHref={csvHref} />}
      {drive && grant && <DriveDisconnectItem googleEmail={grant.googleEmail} />}
    </DropdownMenu>
  )
}
