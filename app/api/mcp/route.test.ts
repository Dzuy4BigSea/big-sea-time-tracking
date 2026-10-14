/**
 * /api/mcp's 401 challenge (specs/22 §OAuth): MCP clients discover the authorization server from the
 * WWW-Authenticate header (RFC 9728 resource_metadata). Prisma is mocked; no database needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }))
const db = vi.hoisted(() => ({
  apiToken: { findUnique: vi.fn(), update: vi.fn() },
  oAuthToken: { findUnique: vi.fn() },
  oAuthGrant: { update: vi.fn() },
  user: { findUnique: vi.fn() },
  auditLog: { create: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/auth', () => ({ auth: vi.fn() }))

import { POST, OPTIONS } from './route'

function call(authorization?: string) {
  return POST(
    new Request('https://track2.bigseabridge.com/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }),
  )
}

beforeEach(() => {
  vi.stubEnv('APP_URL', 'https://track2.bigseabridge.com')
  db.apiToken.findUnique.mockResolvedValue(null)
  db.oAuthToken.findUnique.mockResolvedValue(null)
})

describe('/api/mcp authentication', () => {
  it('answers 401 with a resource_metadata challenge when no token is sent', async () => {
    const res = await call()
    expect(res.status).toBe(401)
    const h = res.headers.get('www-authenticate')!
    expect(h).toContain('Bearer')
    expect(h).toContain('resource_metadata="https://track2.bigseabridge.com/.well-known/oauth-protected-resource"')
    expect(h).not.toContain('invalid_token')
    expect(res.headers.get('access-control-expose-headers')).toContain('WWW-Authenticate')
  })

  it('marks an unknown OAuth access token or PAT as invalid_token', async () => {
    for (const t of [`track2_oat_${'A'.repeat(43)}`, `track2_pat_${'A'.repeat(43)}`]) {
      const res = await call(`Bearer ${t}`)
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"')
    }
    expect(db.oAuthToken.findUnique).toHaveBeenCalled()
    expect(db.apiToken.findUnique).toHaveBeenCalled()
  })

  it('accepts a live OAuth access token for the MCP resource', async () => {
    db.oAuthToken.findUnique.mockResolvedValue({
      id: 't1',
      kind: 'access',
      expiresAt: new Date(Date.now() + 60_000),
      rotatedAt: null,
      revokedAt: null,
      grant: { id: 'g1', accountId: 'acct1', userId: 'u1', clientId: 'c1', resource: 'https://track2.bigseabridge.com/api/mcp', scope: null, revokedAt: null, lastUsedAt: new Date() },
    })
    db.user.findUnique.mockResolvedValue({ accountId: 'acct1', isActive: true, permissionProfile: 'member', permissionOverrides: null })
    const res = await call(`Bearer track2_oat_${'A'.repeat(43)}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.result.tools)).toBe(true)
  })

  it('refuses an OAuth token whose user was deactivated', async () => {
    db.oAuthToken.findUnique.mockResolvedValue({
      id: 't1',
      kind: 'access',
      expiresAt: new Date(Date.now() + 60_000),
      rotatedAt: null,
      revokedAt: null,
      grant: { id: 'g1', accountId: 'acct1', userId: 'u1', clientId: 'c1', resource: 'https://track2.bigseabridge.com/api/mcp', scope: null, revokedAt: null, lastUsedAt: new Date() },
    })
    db.user.findUnique.mockResolvedValue({ accountId: 'acct1', isActive: false, permissionProfile: 'member', permissionOverrides: null })
    expect((await call(`Bearer track2_oat_${'A'.repeat(43)}`)).status).toBe(401)
  })

  it('answers CORS preflight', async () => {
    const res = await OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
