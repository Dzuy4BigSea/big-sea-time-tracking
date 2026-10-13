import { getCurrentUser } from '@/lib/session'
import { appRedirect, deleteGrant } from '@/lib/googleDrive'
import { isSameOrigin, safeReturnTo, withDriveResult } from '@/modules/integrations/googleDrive'

export const dynamic = 'force-dynamic'

/** POST (form): forget the signed-in user's own Drive grant and revoke it at Google. */
export async function POST(req: Request) {
  const me = await getCurrentUser()
  if (!me) return appRedirect(req, '/login')
  if (!isSameOrigin(req.headers.get('origin'), req.url)) return new Response('Forbidden', { status: 403 })
  const form = await req.formData().catch(() => null)
  const returnTo = safeReturnTo(form?.get('returnTo')) ?? '/'
  await deleteGrant(me, { revoke: true })
  return appRedirect(req, withDriveResult(returnTo, { drive: 'disconnected' }))
}
