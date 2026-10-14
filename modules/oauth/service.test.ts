import { describe, it, expect, beforeEach } from 'vitest'
import {
  exchangeAuthorizationCode,
  issueAuthorizationCode,
  refreshTokens,
  resolveAccessToken,
  revokeToken,
  type CodeRecord,
  type GrantRecord,
  type NewToken,
  type OAuthStore,
  type TokenRecord,
} from './service'
import { ACCESS_TOKEN_TTL_MS, AUTH_CODE_TTL_MS, REFRESH_TOKEN_TTL_MS, s256Challenge } from './crypto'

/** In-memory store with the same atomicity contract as lib/oauth/store.ts. */
function memoryStore() {
  let seq = 0
  const codes = new Map<string, CodeRecord & { codeHash: string; usedAt: Date | null }>()
  const grants = new Map<string, GrantRecord>()
  const tokens = new Map<string, { id: string; grantId: string; kind: 'access' | 'refresh'; tokenHash: string; expiresAt: Date; rotatedAt: Date | null; revokedAt: Date | null }>()
  const addTokens = (grantId: string, ts: NewToken[]) => {
    for (const t of ts) {
      const id = `t${++seq}`
      tokens.set(id, { id, grantId, ...t, rotatedAt: null, revokedAt: null })
    }
  }
  const store: OAuthStore = {
    async createCode(c) {
      const id = `c${++seq}`
      codes.set(id, { ...c, id, grantId: null, usedAt: null })
    },
    async consumeCode(codeHash, now) {
      const c = [...codes.values()].find((x) => x.codeHash === codeHash)
      if (!c) return { status: 'missing' }
      if (c.usedAt) return { status: 'reused', code: { ...c } }
      c.usedAt = now
      return { status: 'ok', code: { ...c } }
    },
    async createGrant({ codeId, grant, tokens: ts }) {
      const id = `g${++seq}`
      grants.set(id, { ...grant, id, revokedAt: null })
      addTokens(id, ts)
      codes.get(codeId)!.grantId = id
      return id
    },
    async findToken(tokenHash) {
      const t = [...tokens.values()].find((x) => x.tokenHash === tokenHash)
      if (!t) return null
      return { id: t.id, kind: t.kind, expiresAt: t.expiresAt, rotatedAt: t.rotatedAt, revokedAt: t.revokedAt, grant: { ...grants.get(t.grantId)! } } satisfies TokenRecord
    },
    async rotateRefresh(oldId, grantId, now, ts) {
      const t = tokens.get(oldId)!
      if (t.rotatedAt || t.revokedAt) return false
      t.rotatedAt = now
      addTokens(grantId, ts)
      return true
    },
    async revokeGrant(grantId, now) {
      const g = grants.get(grantId)!
      g.revokedAt ??= now
      for (const t of tokens.values()) if (t.grantId === grantId) t.revokedAt ??= now
    },
  }
  return { store, codes, grants, tokens }
}

const APP_RESOURCE = 'https://track2.bigseabridge.com/api/mcp'
const CB = 'https://claude.ai/api/mcp/auth_callback'
const VERIFIER = 'dBjftJeZ4CVP-mJ92K9iHSWQR1ZgV1xWXz6Ph8FzgTk'
const T0 = new Date('2026-10-14T12:00:00Z')
const at = (ms: number) => new Date(T0.getTime() + ms)

let m: ReturnType<typeof memoryStore>

async function code(store = m.store) {
  return issueAuthorizationCode(
    store,
    { clientRowId: 'client1', accountId: 'acct1', userId: 'u1', redirectUri: CB, codeChallenge: s256Challenge(VERIFIER), resource: APP_RESOURCE },
    T0,
  )
}

async function exchange(c: string, patch: Partial<{ clientRowId: string; codeVerifier: string; redirectUri: string; resource: string | null }> = {}, now = at(1000)) {
  return exchangeAuthorizationCode(m.store, { clientRowId: 'client1', code: c, codeVerifier: VERIFIER, redirectUri: CB, resource: APP_RESOURCE, ...patch }, now)
}

beforeEach(() => {
  m = memoryStore()
})

describe('authorization code', () => {
  it('is stored hashed, bound to client/user/redirect/challenge/resource, 10 minutes', async () => {
    const c = await code()
    expect(c).toMatch(/^track2_oac_/)
    const row = [...m.codes.values()][0]
    expect(row.codeHash).not.toContain(c)
    expect(JSON.stringify(row)).not.toContain(c)
    expect(row).toMatchObject({ clientId: 'client1', userId: 'u1', accountId: 'acct1', redirectUri: CB, resource: APP_RESOURCE })
    expect(row.expiresAt.getTime() - T0.getTime()).toBe(AUTH_CODE_TTL_MS)
  })

  it('exchanges once for an access + refresh token', async () => {
    const r = await exchange(await code())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.token_type).toBe('Bearer')
    expect(r.value.expires_in).toBe(ACCESS_TOKEN_TTL_MS / 1000)
    expect(r.value.access_token).toMatch(/^track2_oat_/)
    expect(r.value.refresh_token).toMatch(/^track2_ort_/)
    const stored = [...m.tokens.values()]
    expect(stored.map((t) => t.kind).sort()).toEqual(['access', 'refresh'])
    expect(JSON.stringify(stored)).not.toContain(r.value.access_token)
    const refresh = stored.find((t) => t.kind === 'refresh')!
    expect(refresh.expiresAt.getTime() - at(1000).getTime()).toBe(REFRESH_TOKEN_TTL_MS)
  })

  it('rejects a reused code and revokes the grant it produced', async () => {
    const c = await code()
    const first = await exchange(c)
    expect(first.ok).toBe(true)
    const second = await exchange(c)
    expect(second).toEqual({ ok: false, error: { error: 'invalid_grant', error_description: 'Authorization code already used' } })
    expect([...m.grants.values()][0].revokedAt).not.toBeNull()
    if (first.ok) expect(await resolveAccessToken(m.store, first.value.access_token, APP_RESOURCE, at(2000))).toBeNull()
  })

  it('verifies PKCE, redirect_uri, client, expiry and resource — and burns the code on failure', async () => {
    const checks: Array<[Parameters<typeof exchange>[1], string, Date?]> = [
      [{ codeVerifier: 'x'.repeat(43) }, 'invalid_grant'],
      [{ redirectUri: 'https://claude.ai/other' }, 'invalid_grant'],
      [{ clientRowId: 'client2' }, 'invalid_grant'],
      [{ resource: 'https://evil.com/api/mcp' }, 'invalid_target'],
      [{}, 'invalid_grant', at(AUTH_CODE_TTL_MS + 1)],
    ]
    for (const [patch, error, now] of checks) {
      const c = await code()
      const r = await exchange(c, patch, now)
      expect(r).toMatchObject({ ok: false, error: { error } })
      // One-time: even the correct request can't use it afterwards.
      expect(await exchange(c)).toMatchObject({ ok: false, error: { error: 'invalid_grant' } })
    }
    expect(m.grants.size).toBe(0)
  })

  it('requires a verifier and a well-formed code', async () => {
    const c = await code()
    expect(await exchangeAuthorizationCode(m.store, { clientRowId: 'client1', code: c, codeVerifier: undefined, redirectUri: CB, resource: null }, T0)).toMatchObject({
      ok: false,
      error: { error: 'invalid_request' },
    })
    expect(await exchange('nope')).toMatchObject({ ok: false, error: { error: 'invalid_grant' } })
    expect(await exchange('track2_oac_' + 'A'.repeat(43))).toMatchObject({ ok: false, error: { error: 'invalid_grant' } })
  })

  it('accepts a token request without resource', async () => {
    expect((await exchange(await code(), { resource: null })).ok).toBe(true)
  })
})

describe('access tokens', () => {
  it('resolve to the grant until they expire, for the MCP resource only', async () => {
    const r = await exchange(await code())
    if (!r.ok) throw new Error('exchange failed')
    const g = await resolveAccessToken(m.store, r.value.access_token, APP_RESOURCE, at(2000))
    expect(g).toMatchObject({ accountId: 'acct1', userId: 'u1', clientId: 'client1' })
    expect(await resolveAccessToken(m.store, r.value.access_token, 'https://other/api/mcp', at(2000))).toBeNull()
    expect(await resolveAccessToken(m.store, r.value.access_token, APP_RESOURCE, at(1000 + ACCESS_TOKEN_TTL_MS))).toBeNull()
    // A refresh token is not an access token.
    expect(await resolveAccessToken(m.store, r.value.refresh_token, APP_RESOURCE, at(2000))).toBeNull()
    expect(await resolveAccessToken(m.store, 'track2_pat_whatever', APP_RESOURCE, at(2000))).toBeNull()
  })
})

describe('refresh', () => {
  async function tokens() {
    const r = await exchange(await code())
    if (!r.ok) throw new Error('exchange failed')
    return r.value
  }

  it('rotates: new access + refresh token, the old refresh token is spent', async () => {
    const t1 = await tokens()
    const r = await refreshTokens(m.store, { clientRowId: 'client1', refreshToken: t1.refresh_token, resource: null }, at(60_000))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.refresh_token).not.toBe(t1.refresh_token)
    expect(r.value.access_token).not.toBe(t1.access_token)
    expect(await resolveAccessToken(m.store, r.value.access_token, APP_RESOURCE, at(61_000))).not.toBeNull()
    // Still one grant (same family).
    expect(m.grants.size).toBe(1)
    // The rotated chain keeps working.
    const r2 = await refreshTokens(m.store, { clientRowId: 'client1', refreshToken: r.value.refresh_token, resource: APP_RESOURCE }, at(120_000))
    expect(r2.ok).toBe(true)
  })

  it('detects reuse of a rotated refresh token and revokes the whole family', async () => {
    const t1 = await tokens()
    const r = await refreshTokens(m.store, { clientRowId: 'client1', refreshToken: t1.refresh_token, resource: null }, at(60_000))
    if (!r.ok) throw new Error('refresh failed')
    const replay = await refreshTokens(m.store, { clientRowId: 'client1', refreshToken: t1.refresh_token, resource: null }, at(70_000))
    expect(replay).toEqual({ ok: false, error: { error: 'invalid_grant', error_description: 'Refresh token already used' } })
    // The legitimate holder's newer tokens die too.
    expect(await resolveAccessToken(m.store, r.value.access_token, APP_RESOURCE, at(71_000))).toBeNull()
    expect(await refreshTokens(m.store, { clientRowId: 'client1', refreshToken: r.value.refresh_token, resource: null }, at(72_000))).toMatchObject({ ok: false })
  })

  it('rejects another client, an expired token, a wrong resource, an access token', async () => {
    const t1 = await tokens()
    expect(await refreshTokens(m.store, { clientRowId: 'client2', refreshToken: t1.refresh_token, resource: null }, at(60_000))).toMatchObject({ ok: false, error: { error: 'invalid_grant' } })
    expect(await refreshTokens(m.store, { clientRowId: 'client1', refreshToken: t1.refresh_token, resource: 'https://x/api/mcp' }, at(60_000))).toMatchObject({
      ok: false,
      error: { error: 'invalid_target' },
    })
    expect(await refreshTokens(m.store, { clientRowId: 'client1', refreshToken: t1.access_token, resource: null }, at(60_000))).toMatchObject({ ok: false })
    expect(await refreshTokens(m.store, { clientRowId: 'client1', refreshToken: t1.refresh_token, resource: null }, at(1000 + REFRESH_TOKEN_TTL_MS))).toMatchObject({
      ok: false,
      error: { error: 'invalid_grant', error_description: 'Refresh token expired' },
    })
  })
})

describe('revocation', () => {
  it('revoking either token revokes the grant (both tokens)', async () => {
    const r = await exchange(await code())
    if (!r.ok) throw new Error('exchange failed')
    await revokeToken(m.store, { clientRowId: 'client1', token: r.value.refresh_token }, at(5000))
    expect(await resolveAccessToken(m.store, r.value.access_token, APP_RESOURCE, at(6000))).toBeNull()
    expect(await refreshTokens(m.store, { clientRowId: 'client1', refreshToken: r.value.refresh_token, resource: null }, at(7000))).toMatchObject({ ok: false })
  })

  it("ignores unknown tokens and other clients' tokens", async () => {
    const r = await exchange(await code())
    if (!r.ok) throw new Error('exchange failed')
    await revokeToken(m.store, { clientRowId: 'client2', token: r.value.access_token }, at(5000))
    await revokeToken(m.store, { clientRowId: 'client1', token: 'garbage' }, at(5000))
    expect(await resolveAccessToken(m.store, r.value.access_token, APP_RESOURCE, at(6000))).not.toBeNull()
  })
})
