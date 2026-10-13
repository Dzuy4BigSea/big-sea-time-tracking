import { getCurrentUser } from '@/lib/session'
import { appRedirect, driveConfig, startConsent } from '@/lib/googleDrive'
import { safeReturnTo } from '@/modules/integrations/googleDrive'

export const dynamic = 'force-dynamic'

/**
 * GET /api/google/drive/connect?returnTo=/path → Google's consent screen for drive.file (incremental
 * consent; sign-in scopes are untouched). It only starts consent: an export to run afterwards is put
 * into the signed state by the POST export endpoint, never taken from this URL.
 */
export async function GET(req: Request) {
  const me = await getCurrentUser()
  if (!me) return appRedirect(req, '/login')
  const cfg = driveConfig()
  if (!cfg) return new Response('Not found', { status: 404 })
  const returnTo = safeReturnTo(new URL(req.url).searchParams.get('returnTo')) ?? '/'
  return startConsent(req, me, cfg, { returnTo, exportHref: null })
}
