import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { resolveAppUrl } from '@/lib/appUrl'
import { displayToken } from '@/modules/apiTokens/token'
import { ApiTokenCreateForm } from '@/components/ApiTokenCreateForm'
import { ConfirmSubmit } from '@/components/ConfirmSubmit'
import { revokeApiTokenAction } from './actions'

export const dynamic = 'force-dynamic'

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

      <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Connect Claude</h2>
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
