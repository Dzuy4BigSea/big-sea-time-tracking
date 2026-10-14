import { NextResponse } from 'next/server'
import { resolveAppUrl } from '@/lib/appUrl'
import { writeAudit } from '@/lib/audit'
import { getCurrentUser } from '@/lib/session'
import { AUTHORIZE_PARAMS, authorizePath, checkAuthorizeRequest } from '@/lib/oauth/authorize'
import { prismaOAuthStore } from '@/lib/oauth/store'
import { isSameOriginPost } from '@/modules/oauth/requests'
import { withParams } from '@/modules/oauth/redirectUri'
import { issueAuthorizationCode } from '@/modules/oauth/service'

/**
 * The consent form's POST (specs/22 §OAuth). CSRF-safe: same-origin POST only (Origin check) and the
 * signed-in session is re-read; every authorization parameter is validated again (the hidden fields
 * are user-controlled). Allow → one-time code (10 min, hashed) → 303 to the registered redirect URI
 * with code + state. Deny → 303 with error=access_denied + state.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

function plain(status: number, message: string) {
  return new NextResponse(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...noStore } })
}

export async function POST(req: Request) {
  const appUrl = resolveAppUrl()
  if (!isSameOriginPost(req.headers.get('origin'), req.headers.get('sec-fetch-site'), appUrl)) {
    return plain(403, 'Cross-site request refused.')
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return plain(400, 'Malformed request.')
  }
  const params: Record<string, string | undefined> = {}
  for (const k of AUTHORIZE_PARAMS) {
    const v = form.get(k)
    if (typeof v === 'string') params[k] = v
  }

  const me = await getCurrentUser()
  if (!me) {
    return NextResponse.redirect(new URL(`/login?callbackUrl=${encodeURIComponent(authorizePath(params))}`, appUrl), { status: 303, headers: noStore })
  }

  const { check, client } = await checkAuthorizeRequest(params)
  if (check.kind === 'fatal') return plain(400, check.message)
  if (check.kind === 'redirect_error') {
    return NextResponse.redirect(withParams(check.redirectUri, { error: check.error, error_description: check.description, state: check.state }), { status: 303, headers: noStore })
  }
  const r = check.request

  if (form.get('decision') !== 'allow') {
    return NextResponse.redirect(withParams(r.redirectUri, { error: 'access_denied', error_description: 'The user denied access', state: r.state }), {
      status: 303,
      headers: noStore,
    })
  }

  const code = await issueAuthorizationCode(prismaOAuthStore, {
    clientRowId: client!.id,
    accountId: me.accountId,
    userId: me.userId,
    redirectUri: r.redirectUri,
    codeChallenge: r.codeChallenge,
    resource: r.resource,
    scope: r.scope,
  })
  await writeAudit({
    accountId: me.accountId,
    actorUserId: me.userId,
    entityType: 'oauth_client',
    entityId: client!.id,
    action: 'create',
    summary: `Connected app “${client!.clientName}” authorized`,
    detail: { clientId: client!.clientId, redirectHost: new URL(r.redirectUri).host },
  })
  return NextResponse.redirect(withParams(r.redirectUri, { code, state: r.state }), { status: 303, headers: noStore })
}
