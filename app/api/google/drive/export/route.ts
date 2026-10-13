import { getCurrentUser } from '@/lib/session'
import { accessTokenFor, appRedirect, driveConfig, errorRedirect, runDriveExport, startConsent } from '@/lib/googleDrive'
import { isSameOrigin, parseExportHref, safeReturnTo, withDriveResult } from '@/modules/integrations/googleDrive'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // all-time exports page through ~200 batches before uploading

/**
 * POST (form) from an "Export ▾ → Google Drive" menu: `exportHref` is the same link the CSV item
 * downloads (only the four report export paths are accepted), `returnTo` the page to come back to.
 * The export builder re-checks permissions and account scope exactly as the CSV route does.
 * No grant yet (or Google revoked it) → consent first; the callback then runs this export.
 */
export async function POST(req: Request) {
  const me = await getCurrentUser()
  if (!me) return appRedirect(req, '/login')
  if (!isSameOrigin(req.headers.get('origin'), req.url)) return new Response('Forbidden', { status: 403 })

  const form = await req.formData().catch(() => null)
  const returnTo = safeReturnTo(form?.get('returnTo')) ?? '/'
  const cfg = driveConfig()
  if (!cfg) return errorRedirect(req, returnTo, 'not_configured')
  const target = parseExportHref(form?.get('exportHref'))
  if (!target) return errorRedirect(req, returnTo, 'export_not_found')

  const token = await accessTokenFor(me, cfg)
  if (!token.ok) {
    if (token.reason === 'error') return errorRedirect(req, returnTo, 'token')
    return startConsent(req, me, cfg, { returnTo, exportHref: target.href })
  }
  const result = await runDriveExport(me, target.href, token.accessToken)
  return appRedirect(req, withDriveResult(returnTo, result.ok ? { driveFile: result.fileId } : { driveError: result.code }))
}
