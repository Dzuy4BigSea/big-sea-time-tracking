import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { DRIVE_RESULT_PARAMS, isDriveFileId, sheetUrl } from './googleDriveShared'
export * from './googleDriveShared'

/**
 * "Export → Google Drive" (OPS.md §8): pure, DB-free pieces. The server glue (grant storage, routes)
 * lives in lib/googleDrive.ts and app/api/google/drive/*.
 *
 * - Our own small OAuth flow asks for `drive.file` (only files the app creates) the first time a user
 *   exports, via incremental consent. Sign-in scopes are untouched (openid email profile).
 * - The OAuth `state` is HMAC-signed with AUTH_SECRET, bound to the Track2 user and a browser nonce
 *   cookie, and expires after STATE_TTL_MS.
 * - Uploads are a CSV body that Drive converts to a native Google Sheet.
 *
 * Nothing here logs or returns token values; error results carry only codes and HTTP statuses.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
/** `openid email` lets the callback check the Google account is the signed-in Track2 user's own. */
export const DRIVE_CONSENT_SCOPES = ['openid', 'email', DRIVE_SCOPE]
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
export const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
export const SHEET_MIME = 'application/vnd.google-apps.spreadsheet'

export const STATE_TTL_MS = 10 * 60 * 1000
export const NONCE_COOKIE = 't2_gdrive_nonce'
export const CALLBACK_PATH = '/api/google/drive/callback'

/** Drive's simple multipart upload takes ≤5 MB; above that we use a single-request resumable upload. */
export const MULTIPART_MAX_BYTES = 5 * 1024 * 1024
/** Refuse exports beyond these (Sheets holds 10M cells; Drive converts CSVs up to ~100 MB). */
export const DRIVE_MAX_CELLS = 9_000_000
export const DRIVE_MAX_BYTES = 80 * 1024 * 1024


type FetchFn = typeof fetch

// ── Paths ───────────────────────────────────────────────────────────────────────────────────────

const BASE = 'http://track2.invalid'

/** A same-app relative path ("/reports?tab=…") or null. Rejects absolute, protocol-relative and odd URLs. */
export function safeReturnTo(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /[\u0000-\u001f\u007f]/.test(raw)) return null
  let u: URL
  try {
    u = new URL(raw, BASE)
  } catch {
    return null
  }
  if (u.origin !== BASE || u.pathname.startsWith('/api/')) return null
  for (const k of DRIVE_RESULT_PARAMS) u.searchParams.delete(k)
  return u.pathname + (u.search === '?' ? '' : u.search)
}

/** Append result params to a validated relative path. */
export function withDriveResult(returnTo: string, result: Partial<Record<(typeof DRIVE_RESULT_PARAMS)[number], string>>): string {
  const u = new URL(safeReturnTo(returnTo) ?? '/', BASE)
  for (const [k, v] of Object.entries(result)) if (v) u.searchParams.set(k, v)
  return u.pathname + u.search
}

export type ExportKind = 'time' | 'detailed' | 'profitability' | 'project_tasks'
export interface ExportTarget {
  kind: ExportKind
  projectId?: string
  params: URLSearchParams
  /** Normalized relative href (path + query), safe to put in state. */
  href: string
}

/**
 * Map a CSV export link (the same href the "CSV" menu item downloads) to the export it names. Only
 * these four paths are accepted, so a form can't make the Drive endpoint run anything else.
 */
export function parseExportHref(raw: unknown): ExportTarget | null {
  if (typeof raw !== 'string' || raw.length > 4000 || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null
  let u: URL
  try {
    u = new URL(raw, BASE)
  } catch {
    return null
  }
  if (u.origin !== BASE) return null
  const href = u.pathname + (u.search === '?' ? '' : u.search)
  const fixed: Record<string, ExportKind> = {
    '/reports/export': 'time',
    '/reports/detailed/export': 'detailed',
    '/reports/profitability/export': 'profitability',
  }
  if (fixed[u.pathname]) return { kind: fixed[u.pathname], params: u.searchParams, href }
  const m = /^\/projects\/([A-Za-z0-9_-]{1,64})\/tasks\/export$/.exec(u.pathname)
  if (m) return { kind: 'project_tasks', projectId: m[1], params: u.searchParams, href }
  return null
}

/** Same-origin check for state-changing POSTs (on top of SameSite=Lax session cookies). */
export function isSameOrigin(originHeader: string | null, requestUrl: string, secFetchSite: string | null = null): boolean {
  // No Origin header: only accept when the browser says the request is same-origin (Sec-Fetch-Site).
  if (!originHeader) return secFetchSite === 'same-origin'
  try {
    return new URL(originHeader).origin === new URL(requestUrl).origin
  } catch {
    return false
  }
}

// ── State ───────────────────────────────────────────────────────────────────────────────────────

export interface DriveState {
  userId: string
  accountId: string
  returnTo: string
  /** A CSV export href to run straight after consent (set only by the POST export endpoint). */
  exportHref: string | null
  nonce: string
  expiresAt: number
}

const b64url = (b: Buffer) => b.toString('base64url')

function stateKey(secret: string): Buffer {
  // Domain-separated from Auth.js' own use of AUTH_SECRET.
  return createHmac('sha256', secret).update('track2:google-drive-oauth-state:v1').digest()
}

export function newNonce(): string {
  return b64url(randomBytes(18))
}

export function signState(
  input: Omit<DriveState, 'expiresAt' | 'nonce'> & { nonce?: string },
  secret: string,
  now: number = Date.now(),
): { state: string; nonce: string } {
  if (!secret) throw new Error('AUTH_SECRET is not set.')
  const nonce = input.nonce ?? newNonce()
  const body: DriveState = {
    userId: input.userId,
    accountId: input.accountId,
    returnTo: safeReturnTo(input.returnTo) ?? '/',
    exportHref: input.exportHref ? parseExportHref(input.exportHref)?.href ?? null : null,
    nonce,
    expiresAt: now + STATE_TTL_MS,
  }
  const payload = b64url(Buffer.from(JSON.stringify(body), 'utf8'))
  const sig = b64url(createHmac('sha256', stateKey(secret)).update(payload).digest())
  return { state: `${payload}.${sig}`, nonce }
}

export type StateCheck = { ok: true; state: DriveState } | { ok: false; reason: 'malformed' | 'signature' | 'expired' | 'user' | 'nonce' }

/** Verify signature, expiry, the signed-in user and the browser nonce cookie. */
export function verifyState(
  raw: unknown,
  secret: string,
  expect: { userId: string; accountId: string; nonce: string | null | undefined },
  now: number = Date.now(),
): StateCheck {
  if (typeof raw !== 'string' || raw.length > 8000 || !secret) return { ok: false, reason: 'malformed' }
  const dot = raw.indexOf('.')
  if (dot <= 0 || dot !== raw.lastIndexOf('.')) return { ok: false, reason: 'malformed' }
  const payload = raw.slice(0, dot)
  const given = Buffer.from(raw.slice(dot + 1), 'base64url')
  const want = createHmac('sha256', stateKey(secret)).update(payload).digest()
  if (given.length !== want.length || !timingSafeEqual(given, want)) return { ok: false, reason: 'signature' }
  let s: DriveState
  try {
    s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!s || typeof s !== 'object' || typeof s.userId !== 'string' || typeof s.nonce !== 'string' || typeof s.expiresAt !== 'number') {
    return { ok: false, reason: 'malformed' }
  }
  if (now > s.expiresAt) return { ok: false, reason: 'expired' }
  if (s.userId !== expect.userId || s.accountId !== expect.accountId) return { ok: false, reason: 'user' }
  const n = Buffer.from(String(expect.nonce ?? ''), 'utf8')
  const sn = Buffer.from(s.nonce, 'utf8')
  if (!expect.nonce || n.length !== sn.length || !timingSafeEqual(n, sn)) return { ok: false, reason: 'nonce' }
  return {
    ok: true,
    state: { ...s, returnTo: safeReturnTo(s.returnTo) ?? '/', exportHref: s.exportHref ? parseExportHref(s.exportHref)?.href ?? null : null },
  }
}

// ── OAuth ───────────────────────────────────────────────────────────────────────────────────────

export function buildConsentUrl(p: { clientId: string; redirectUri: string; state: string; loginHint?: string; hostedDomain?: string | null }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: DRIVE_CONSENT_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: p.state,
  })
  if (p.loginHint) q.set('login_hint', p.loginHint)
  if (p.hostedDomain) q.set('hd', p.hostedDomain)
  return `${GOOGLE_AUTH_URL}?${q.toString()}`
}

export type TokenError = 'invalid_grant' | 'http' | 'network'
export type TokenResult =
  | { ok: true; accessToken: string; refreshToken: string | null; scope: string; idToken: string | null }
  | { ok: false; error: TokenError; status?: number }

async function tokenRequest(fetchFn: FetchFn, body: Record<string, string>): Promise<TokenResult> {
  let res: Response
  try {
    res = await fetchFn(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body).toString(),
      cache: 'no-store',
    })
  } catch {
    return { ok: false, error: 'network' }
  }
  let json: Record<string, unknown> = {}
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    // invalid_grant = refresh token revoked/expired (or code reused): the user has to reconnect.
    return { ok: false, error: json.error === 'invalid_grant' ? 'invalid_grant' : 'http', status: res.status }
  }
  if (typeof json.access_token !== 'string' || !json.access_token) return { ok: false, error: 'http', status: res.status }
  return {
    ok: true,
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' && json.refresh_token ? json.refresh_token : null,
    scope: typeof json.scope === 'string' ? json.scope : '',
    idToken: typeof json.id_token === 'string' ? json.id_token : null,
  }
}

export function exchangeCode(fetchFn: FetchFn, p: { code: string; clientId: string; clientSecret: string; redirectUri: string }): Promise<TokenResult> {
  return tokenRequest(fetchFn, {
    grant_type: 'authorization_code',
    code: p.code,
    client_id: p.clientId,
    client_secret: p.clientSecret,
    redirect_uri: p.redirectUri,
  })
}

export function refreshAccessToken(fetchFn: FetchFn, p: { refreshToken: string; clientId: string; clientSecret: string }): Promise<TokenResult> {
  return tokenRequest(fetchFn, {
    grant_type: 'refresh_token',
    refresh_token: p.refreshToken,
    client_id: p.clientId,
    client_secret: p.clientSecret,
  })
}

/** Best-effort revoke at Google (Disconnect). Never throws. */
export async function revokeToken(fetchFn: FetchFn, token: string): Promise<boolean> {
  try {
    const res = await fetchFn(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}

export function hasDriveScope(scope: string): boolean {
  return scope.split(/\s+/).includes(DRIVE_SCOPE)
}

/**
 * Email claims from the ID token returned by Google's token endpoint. It came straight from Google
 * over TLS in exchange for our client secret, so (per OpenID Connect Core §3.1.3.7) the TLS server
 * validation stands in for the signature check here.
 */
export function idTokenEmail(idToken: string | null): { email: string; verified: boolean } | null {
  if (!idToken) return null
  const parts = idToken.split('.')
  if (parts.length !== 3) return null
  try {
    const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { email?: unknown; email_verified?: unknown }
    if (typeof c.email !== 'string' || !c.email) return null
    return { email: c.email.trim().toLowerCase(), verified: c.email_verified === true || c.email_verified === 'true' }
  } catch {
    return null
  }
}

// ── Upload ──────────────────────────────────────────────────────────────────────────────────────

export interface DriveRequest {
  url: string
  init: { method: string; headers: Record<string, string>; body: string }
}

export function sheetMetadata(name: string) {
  return { name, mimeType: SHEET_MIME }
}

/** Multipart (metadata + CSV media) upload; Drive converts the CSV to a native Sheet. */
export function buildMultipartUpload(p: { accessToken: string; name: string; csv: string; boundary?: string }): DriveRequest {
  const boundary = p.boundary ?? `track2_${randomBytes(12).toString('hex')}`
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(sheetMetadata(p.name)) +
    `\r\n--${boundary}\r\n` +
    'Content-Type: text/csv; charset=UTF-8\r\n\r\n' +
    p.csv +
    `\r\n--${boundary}--\r\n`
  return {
    url: `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,webViewLink`,
    init: {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  }
}

/** Step 1 of a resumable upload (larger CSVs): metadata only; Google answers with a Location URL. */
export function buildResumableStart(p: { accessToken: string; name: string; byteLength: number }): DriveRequest {
  return {
    url: `${DRIVE_UPLOAD_URL}?uploadType=resumable&fields=id,webViewLink`,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${p.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'text/csv',
        'X-Upload-Content-Length': String(p.byteLength),
      },
      body: JSON.stringify(sheetMetadata(p.name)),
    },
  }
}

export type DriveError = 'auth' | 'forbidden' | 'too_large' | 'rate_limited' | 'server' | 'network'
export type UploadResult = { ok: true; fileId: string; webViewLink: string } | { ok: false; error: DriveError; status?: number }

export function driveErrorFor(status: number): DriveError {
  if (status === 401) return 'auth'
  if (status === 403) return 'forbidden'
  if (status === 413) return 'too_large'
  if (status === 429) return 'rate_limited'
  return 'server'
}

async function finish(res: Response): Promise<UploadResult> {
  if (!res.ok) return { ok: false, error: driveErrorFor(res.status), status: res.status }
  try {
    const j = (await res.json()) as { id?: unknown; webViewLink?: unknown }
    if (typeof j.id !== 'string' || !isDriveFileId(j.id)) return { ok: false, error: 'server', status: res.status }
    return { ok: true, fileId: j.id, webViewLink: typeof j.webViewLink === 'string' ? j.webViewLink : sheetUrl(j.id) }
  } catch {
    return { ok: false, error: 'server', status: res.status }
  }
}

export async function uploadCsvAsSheet(fetchFn: FetchFn, p: { accessToken: string; name: string; csv: string }): Promise<UploadResult> {
  const bytes = Buffer.byteLength(p.csv, 'utf8')
  try {
    if (bytes <= MULTIPART_MAX_BYTES) {
      const r = buildMultipartUpload(p)
      return await finish(await fetchFn(r.url, { ...r.init, cache: 'no-store' }))
    }
    const start = buildResumableStart({ accessToken: p.accessToken, name: p.name, byteLength: bytes })
    const s = await fetchFn(start.url, { ...start.init, cache: 'no-store' })
    if (!s.ok) return { ok: false, error: driveErrorFor(s.status), status: s.status }
    const location = s.headers.get('location')
    if (!location || !location.startsWith(`${DRIVE_UPLOAD_URL}?`)) return { ok: false, error: 'server', status: s.status }
    const put = await fetchFn(location, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/csv' },
      body: p.csv,
      cache: 'no-store',
    })
    return await finish(put)
  } catch {
    return { ok: false, error: 'network' }
  }
}

// ── Names & messages ────────────────────────────────────────────────────────────────────────────

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dd = (d: Date) => String(d.getUTCDate()).padStart(2, '0')
const dm = (d: Date) => `${dd(d)} ${MON[d.getUTCMonth()]}`
const dmy = (d: Date) => `${dm(d)} ${d.getUTCFullYear()}`

/** "01 Oct–31 Oct 2026", "15 Dec 2025–14 Jan 2026", "01 Oct 2026", "From …", "Through …", "All time". */
export function formatRange(from: Date | null, till: Date | null): string {
  if (!from && !till) return 'All time'
  if (from && !till) return `From ${dmy(from)}`
  if (!from && till) return `Through ${dmy(till)}`
  const f = from!
  const t = till!
  if (f.getTime() === t.getTime()) return dmy(f)
  return f.getUTCFullYear() === t.getUTCFullYear() ? `${dm(f)}–${dmy(t)}` : `${dmy(f)}–${dmy(t)}`
}

/** "Track2 – Time report – Clients – 01 Oct–31 Oct 2026". Parts are cleaned and the name capped. */
export function buildSheetName(parts: (string | null | undefined)[], range: { from: Date | null; till: Date | null }): string {
  const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const segs = ['Track2', ...parts.filter((p): p is string => !!p && !!clean(p)).map(clean), formatRange(range.from, range.till)]
  const name = segs.join(' – ')
  return name.length > 200 ? `${name.slice(0, 199)}…` : name
}
