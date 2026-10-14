/**
 * Xero OAuth2 access-token lifecycle (OPS.md "Xero sync"). DB-free: persistence goes through
 * `XeroTokenStore`, so the race and failure handling are unit-tested.
 *
 * - The access token is refreshed when it expires within `marginMs` (2 min), or on demand after a 401.
 * - Refresh runs under a per-connection lock (Postgres advisory lock in production). Inside the lock
 *   the stored tokens are re-read: if another request already refreshed, its token is used and the
 *   (single-use, rotating) refresh token is NOT spent a second time.
 * - The rotated refresh token, new access token and expiry are saved together, in the same transaction
 *   that holds the lock.
 * - invalid_grant / invalid_client (or a token that no longer reaches the configured tenant) marks the
 *   connection as needing a reconnect and fails every later call fast — it never loops.
 */
import { XeroError, XERO_CONNECTIONS_URL, XERO_TOKEN_URL, xeroHttp, type XeroHttpDeps, type XeroTokenSource } from './xeroClient'

export const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000

export interface XeroTokenState {
  accessToken: string | null
  refreshToken: string | null
  expiresAt: Date | null
  /** Connection status; 'error' = needs reconnect. */
  status: string
}

export interface XeroTokenSet {
  accessToken: string
  /** null for a Custom Connection (client_credentials grant has no refresh token). */
  refreshToken: string | null
  expiresAt: Date
}

export interface XeroTokenStore {
  /** Run `fn` holding the connection's refresh lock, with the tokens as currently stored. */
  withRefreshLock<T>(fn: (current: XeroTokenState, save: (t: XeroTokenSet) => Promise<void>) => Promise<T>): Promise<T>
  /** Flag the connection (status=error + reason) so the UI asks for a reconnect. */
  markNeedsReconnect(reason: string): Promise<void>
}

export interface XeroTokenManagerOptions {
  store: XeroTokenStore
  http: XeroHttpDeps
  initial: XeroTokenState
  clientId: string | null
  clientSecret: string | null
  tenantId: string
  marginMs?: number
  onRefreshed?: (info: { expiresAt: Date; byOtherRequest: boolean }) => void | Promise<void>
  onAuthFailed?: (reason: string) => void | Promise<void>
}

const REAUTH_ERRORS = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client'])

export class XeroTokenManager implements XeroTokenSource {
  private state: XeroTokenState
  private failure: string | null = null
  private inflight: Promise<string> | null = null

  constructor(private readonly opts: XeroTokenManagerOptions) {
    this.state = { ...opts.initial }
    if (opts.initial.status === 'error') this.failure = 'Xero connection needs to be reconnected'
  }

  get needsReconnect(): boolean {
    return this.failure != null
  }

  private now(): number {
    return (this.opts.http.now ?? Date.now)()
  }

  private fresh(s: XeroTokenState): boolean {
    if (!s.accessToken) return false
    if (!s.expiresAt) return true // unknown expiry (pasted token): use it; a 401 triggers a refresh
    return s.expiresAt.getTime() - this.now() > (this.opts.marginMs ?? TOKEN_REFRESH_MARGIN_MS)
  }

  private authError(reason: string): XeroError {
    return new XeroError('auth', `Xero authorization failed — reconnect needed: ${reason}`)
  }

  private async fail(reason: string): Promise<never> {
    if (!this.failure) {
      this.failure = reason
      try {
        await this.opts.store.markNeedsReconnect(reason)
      } catch {
        /* still fail the call below */
      }
      await this.opts.onAuthFailed?.(reason)
    }
    throw this.authError(this.failure)
  }

  async rejected(reason: string): Promise<void> {
    await this.fail(reason).catch(() => {})
  }

  async get(force = false): Promise<string> {
    if (this.failure) throw this.authError(this.failure)
    if (!force && this.fresh(this.state)) return this.state.accessToken as string
    // One refresh per manager at a time (several calls in one request share it).
    if (!this.inflight) {
      const stale = this.state.accessToken
      this.inflight = this.refresh(stale, force).finally(() => {
        this.inflight = null
      })
    }
    return this.inflight
  }

  private async refresh(stale: string | null, force: boolean): Promise<string> {
    const { clientId, clientSecret } = this.opts
    if (!clientId || !clientSecret) {
      if (!force && this.state.accessToken && !this.state.expiresAt) return this.state.accessToken
      return this.fail('access token expired and no Xero client id / secret is configured to refresh it')
    }

    let authFailure: string | null = null
    const result = await this.opts.store.withRefreshLock(async (current, save) => {
      if (current.status === 'error') {
        authFailure = 'Xero connection is marked as needing a reconnect'
        return null
      }
      // Another request refreshed while we waited for the lock: use its token, keep its refresh token.
      if (current.accessToken && current.accessToken !== stale && this.fresh(current)) {
        return { set: current, byOtherRequest: true }
      }
      // Standard (code-flow) app: rotate the refresh token. Custom Connection (no refresh token):
      // client_credentials with the app's id/secret mints a new access token.
      const form: Record<string, string> = current.refreshToken
        ? { grant_type: 'refresh_token', refresh_token: current.refreshToken }
        : { grant_type: 'client_credentials' }
      let res
      try {
        res = await xeroHttp(this.opts.http, {
          method: 'POST',
          url: XERO_TOKEN_URL,
          headers: {
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams(form).toString(),
          retryTransient: true,
        })
      } catch (e) {
        const code = e instanceof XeroError && e.body && typeof e.body === 'object' ? String((e.body as { error?: string }).error ?? '') : ''
        if (e instanceof XeroError && (REAUTH_ERRORS.has(code) || e.kind === 'auth')) {
          authFailure = `token refresh rejected (${code || e.status})`
          return null
        }
        throw e // transient: keep the connection, the sync is retried later
      }
      const j = res.json ?? {}
      if (!j.access_token || (current.refreshToken && !j.refresh_token)) throw new XeroError('http', 'Xero token refresh returned no tokens', { status: res.status })
      const set: XeroTokenSet = {
        accessToken: String(j.access_token),
        refreshToken: j.refresh_token ? String(j.refresh_token) : null,
        expiresAt: new Date(this.now() + Number(j.expires_in ?? 1800) * 1000),
      }
      await save(set) // rotated refresh token + access token + expiry, atomically, under the lock
      return { set: { ...set, status: 'connected' } as XeroTokenState, byOtherRequest: false }
    })

    if (authFailure || !result) return this.fail(authFailure ?? 'token refresh failed')
    this.state = { ...result.set }
    if (!result.byOtherRequest) await this.verifyTenant(this.state.accessToken as string)
    await this.opts.onRefreshed?.({ expiresAt: this.state.expiresAt as Date, byOtherRequest: result.byOtherRequest })
    return this.state.accessToken as string
  }

  /** After a refresh, confirm the token still reaches this connection's tenant (Connections API). */
  private async verifyTenant(accessToken: string): Promise<void> {
    let tenants: Array<{ tenantId?: string }>
    try {
      const res = await xeroHttp(this.opts.http, {
        method: 'GET',
        url: XERO_CONNECTIONS_URL,
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        retryTransient: true,
      })
      tenants = Array.isArray(res.json) ? res.json : []
    } catch (e) {
      if (e instanceof XeroError && e.kind === 'auth') await this.fail('Xero refused the refreshed token')
      return // transient: the API call itself will tell
    }
    if (!tenants.some((t) => t.tenantId === this.opts.tenantId)) {
      await this.fail(`the Xero organisation (tenant ${this.opts.tenantId}) is no longer connected to this app`)
    }
  }
}

/** List the tenants (organisations) a token can reach — used by setup and the tenant check. */
export async function listXeroTenants(http: XeroHttpDeps, accessToken: string): Promise<Array<{ tenantId: string; tenantName: string; tenantType: string }>> {
  const res = await xeroHttp(http, {
    method: 'GET',
    url: XERO_CONNECTIONS_URL,
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    retryTransient: true,
  })
  return (Array.isArray(res.json) ? res.json : []).map((t: any) => ({ tenantId: String(t.tenantId), tenantName: String(t.tenantName ?? ''), tenantType: String(t.tenantType ?? '') }))
}
