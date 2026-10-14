import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/session'
import { AUTHORIZE_PARAMS, authorizePath, checkAuthorizeRequest } from '@/lib/oauth/authorize'
import { redirectHost } from '@/modules/oauth/requests'
import { withParams } from '@/modules/oauth/redirectUri'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Connect to Track2' }

type SearchParams = Record<string, string | string[] | undefined>

/**
 * OAuth 2.1 authorization endpoint + consent screen for MCP clients (specs/22 §OAuth), e.g. a
 * claude.ai custom connector. Signed out → /login?callbackUrl=<this URL>. Bad client / redirect URI →
 * an error here (never a redirect). Other request errors → back to the client with ?error=&state=.
 * Allow / Deny POST to ./decision, which re-validates everything and checks the Origin.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  const me = await getCurrentUser()
  if (!me) redirect(`/login?callbackUrl=${encodeURIComponent(authorizePath(searchParams))}`)

  const { check, client } = await checkAuthorizeRequest(searchParams)
  if (check.kind === 'fatal') return <ErrorCard message={check.message} />
  if (check.kind === 'redirect_error') {
    redirect(withParams(check.redirectUri, { error: check.error, error_description: check.description, state: check.state }))
  }

  const user = await prisma.user.findUnique({ where: { id: me.userId }, select: { firstName: true, lastName: true, email: true } })
  const name = user ? `${user.firstName} ${user.lastName}`.trim() || user.email : 'you'
  const appName = client!.clientName
  const host = redirectHost(check.request.redirectUri)

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="inline-block h-6 w-6 rounded bg-brand-teal" />
          <span className="text-xl font-semibold tracking-tight">Track2</span>
        </div>
        <h1 className="mb-3 text-lg font-semibold">
          {appName} wants to access Track2 as {name}
        </h1>
        <p className="mb-4 text-sm text-gray-700">
          It will be able to read and log time, and work with projects, clients, expenses and draft invoices — with your
          permissions, exactly what you can do in Track2. It can’t send invoices or record payments.
        </p>
        <ul className="mb-6 space-y-1 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
          <li>
            Signed in as <span className="font-medium text-gray-800">{user?.email ?? name}</span>
          </li>
          <li>
            You’ll be sent back to <span className="font-mono text-gray-800">{host}</span>
          </li>
          <li>You can disconnect it any time from Track2 › API tokens › Connected apps.</li>
        </ul>
        <form method="post" action="/oauth/authorize/decision" className="flex gap-3">
          {AUTHORIZE_PARAMS.map((k) => {
            const v = searchParams[k]
            return typeof v === 'string' ? <input key={k} type="hidden" name={k} value={v} /> : null
          })}
          <button
            type="submit"
            name="decision"
            value="deny"
            className="flex-1 rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Deny
          </button>
          <button
            type="submit"
            name="decision"
            value="allow"
            className="flex-1 rounded bg-brand-green px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Allow
          </button>
        </form>
        <p className="mt-4 text-xs text-gray-400">Only allow apps you trust. Not you? Sign out of Track2 first.</p>
      </div>
    </div>
  )
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-lg font-semibold">Can’t connect this app</h1>
        <p className="mb-4 text-sm text-gray-700">{message}</p>
        <p className="text-xs text-gray-500">Try removing and re-adding the connector in the app you came from.</p>
      </div>
    </div>
  )
}
