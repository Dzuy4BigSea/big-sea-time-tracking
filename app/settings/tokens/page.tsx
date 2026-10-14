import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { resolveAppUrl } from '@/lib/appUrl'
import { displayToken } from '@/modules/apiTokens/token'
import { ApiTokenCreateForm } from '@/components/ApiTokenCreateForm'
import { ConfirmSubmit } from '@/components/ConfirmSubmit'
import { revokeApiTokenAction, revokeOAuthGrantAction } from './actions'

export const dynamic = 'force-dynamic'

/** Distinct hosts of a client's redirect URIs ("claude.ai"), to tell connected apps apart. */
function hostsOf(uris: string[]): string {
  const hosts = new Set<string>()
  for (const u of uris) {
    try {
      hosts.add(new URL(u).host)
    } catch {
      /* stored URIs were validated at registration */
    }
  }
  return [...hosts].join(', ')
}

const fmt = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }).format(d) : 'Never'

/**
 * Personal access tokens (specs/22): every active user manages their own tokens for the Track2 API /
 * MCP server. A token acts as its owner with the owner's current permissions.
 */
export default async function ApiTokensPage() {
  const { userId, accountId } = await requireUser()
  const tokens = await prisma.apiToken.findMany({
    where: { userId, accountId },
    select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true, revokedAt: true },
    orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
  })
  // Connected apps (OAuth grants, e.g. claude.ai connectors). A grant whose refresh token lapsed
  // (30 days unused) can't be used again; it stays listed, marked expired, until revoked.
  const grants = await prisma.oAuthGrant.findMany({
    where: { userId, accountId, revokedAt: null },
    select: {
      id: true,
      createdAt: true,
      lastUsedAt: true,
      client: { select: { clientName: true, redirectUris: true } },
      tokens: { where: { kind: 'refresh', revokedAt: null, rotatedAt: null }, select: { expiresAt: true }, take: 1 },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  const now = new Date()
  const mcpUrl = `${resolveAppUrl()}/api/mcp`

  return (
    <div className="max-w-4xl">
      <h1 className="mb-1 text-2xl font-semibold">Personal access tokens</h1>
      <p className="mb-6 text-sm text-gray-600">
        Tokens let Claude (and scripts) use Track2 as you, with exactly your permissions. Treat a token like a password: anyone
        with it can read and change what you can. Revoke a token you no longer use.
      </p>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">New token</h2>
        <ApiTokenCreateForm />
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Your tokens</h2>
        {tokens.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">You have no tokens yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Token</th>
                  <th className="px-4 py-2">Created</th>
                  <th className="px-4 py-2">Last used</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tokens.map((t) => (
                  <tr key={t.id} className={t.revokedAt ? 'text-gray-400' : ''}>
                    <td className="px-4 py-2 font-medium">{t.name}</td>
                    <td className="px-4 py-2 font-mono text-xs">{displayToken(t.prefix)}</td>
                    <td className="px-4 py-2">{fmt(t.createdAt)}</td>
                    <td className="px-4 py-2">{fmt(t.lastUsedAt)}</td>
                    <td className="px-4 py-2 text-right">
                      {t.revokedAt ? (
                        <span className="text-xs">Revoked {fmt(t.revokedAt)}</span>
                      ) : (
                        <form action={revokeApiTokenAction}>
                          <input type="hidden" name="id" value={t.id} />
                          <ConfirmSubmit
                            message={`Revoke “${t.name}”? Anything using it stops working immediately.`}
                            className="rounded border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50"
                          >
                            Revoke
                          </ConfirmSubmit>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Connected apps</h2>
        {grants.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
            No apps connected. Adding Track2 as a connector in claude.ai lists it here.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2">App</th>
                  <th className="px-4 py-2">Returns to</th>
                  <th className="px-4 py-2">Connected</th>
                  <th className="px-4 py-2">Last used</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {grants.map((g) => {
                  const live = g.tokens.some((t) => t.expiresAt > now)
                  return (
                    <tr key={g.id} className={live ? '' : 'text-gray-400'}>
                      <td className="px-4 py-2 font-medium">
                        {g.client.clientName}
                        {!live && <span className="ml-2 text-xs font-normal">(expired)</span>}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{hostsOf(g.client.redirectUris)}</td>
                      <td className="px-4 py-2">{fmt(g.createdAt)}</td>
                      <td className="px-4 py-2">{fmt(g.lastUsedAt)}</td>
                      <td className="px-4 py-2 text-right">
                        <form action={revokeOAuthGrantAction}>
                          <input type="hidden" name="id" value={g.id} />
                          <ConfirmSubmit
                            message={`Disconnect “${g.client.clientName}”? It loses access to Track2 immediately.`}
                            className="rounded border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50"
                          >
                            Revoke
                          </ConfirmSubmit>
                        </form>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Connect claude.ai</h2>
        <p>
          In claude.ai open <span className="font-medium">Settings › Connectors › Add custom connector</span> and enter{' '}
          <code className="rounded bg-gray-100 px-1 font-mono text-xs">{mcpUrl}</code>. Claude opens a Track2 window: sign in if
          asked, then click <span className="font-medium">Allow</span>. No token needed; it then shows up under Connected apps.
        </p>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Connect Claude Code</h2>
        <p className="mb-2">
          Track2’s MCP server is at <code className="rounded bg-gray-100 px-1 font-mono text-xs">{mcpUrl}</code>. It sends your token as a
          Bearer header. In Claude Code:
        </p>
        <pre className="mb-2 overflow-x-auto rounded bg-gray-900 p-3 font-mono text-xs text-gray-100">
          {`claude mcp add --transport http track2 ${mcpUrl} \\\n  --header "Authorization: Bearer track2_pat_…"`}
        </pre>
        <p className="text-gray-500">
          Claude Desktop and other clients: see “How to connect” in specs/22-mcp-server.md.
        </p>
      </section>
    </div>
  )
}
