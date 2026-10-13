import { describe, expect, it, vi } from 'vitest'
import {
  buildConsentUrl,
  buildMultipartUpload,
  buildResumableStart,
  buildSheetName,
  DRIVE_SCOPE,
  driveErrorMessage,
  exchangeCode,
  formatRange,
  hasDriveScope,
  idTokenEmail,
  isSameOrigin,
  MULTIPART_MAX_BYTES,
  parseExportHref,
  refreshAccessToken,
  revokeToken,
  safeReturnTo,
  sheetUrl,
  signState,
  STATE_TTL_MS,
  uploadCsvAsSheet,
  verifyState,
  withDriveResult,
} from './googleDrive'

const SECRET = 'test-auth-secret-0123456789'
const NOW = Date.UTC(2026, 9, 13, 12)
const who = { userId: 'u1', accountId: 'a1' }
const d = (s: string) => new Date(`${s}T00:00:00Z`)

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

describe('state signing', () => {
  const sign = (over: Partial<Parameters<typeof signState>[0]> = {}, now = NOW) =>
    signState({ ...who, returnTo: '/reports?tab=clients', exportHref: '/reports/export?period=month', ...over }, SECRET, now)

  it('round-trips for the same user, browser nonce and within the TTL', () => {
    const { state, nonce } = sign()
    const r = verifyState(state, SECRET, { ...who, nonce }, NOW + STATE_TTL_MS - 1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.state.returnTo).toBe('/reports?tab=clients')
      expect(r.state.exportHref).toBe('/reports/export?period=month')
      expect(r.state.expiresAt).toBe(NOW + STATE_TTL_MS)
    }
  })

  it('rejects expired, tampered, wrong-secret, other-user and wrong-nonce states', () => {
    const { state, nonce } = sign()
    expect(verifyState(state, SECRET, { ...who, nonce }, NOW + STATE_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired' })
    expect(verifyState(state, 'another-secret-xxxxxxxx', { ...who, nonce }, NOW)).toEqual({ ok: false, reason: 'signature' })
    expect(verifyState(state, SECRET, { userId: 'u2', accountId: 'a1', nonce }, NOW)).toEqual({ ok: false, reason: 'user' })
    expect(verifyState(state, SECRET, { userId: 'u1', accountId: 'a2', nonce }, NOW)).toEqual({ ok: false, reason: 'user' })
    expect(verifyState(state, SECRET, { ...who, nonce: 'nope' }, NOW)).toEqual({ ok: false, reason: 'nonce' })
    expect(verifyState(state, SECRET, { ...who, nonce: null }, NOW)).toEqual({ ok: false, reason: 'nonce' })

    // Swap in a payload naming another user, keeping the old signature.
    const [, sig] = state.split('.')
    const forged = Buffer.from(JSON.stringify({ userId: 'u2', accountId: 'a1', returnTo: '/', exportHref: null, nonce, expiresAt: NOW + 1e9 })).toString('base64url')
    expect(verifyState(`${forged}.${sig}`, SECRET, { userId: 'u2', accountId: 'a1', nonce }, NOW)).toEqual({ ok: false, reason: 'signature' })

    expect(verifyState('garbage', SECRET, { ...who, nonce }, NOW)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyState(undefined, SECRET, { ...who, nonce }, NOW)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyState(state, '', { ...who, nonce }, NOW)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('never signs an off-site returnTo or an unknown export path', () => {
    const { state, nonce } = sign({ returnTo: 'https://evil.example/x', exportHref: '/settings/export' })
    const r = verifyState(state, SECRET, { ...who, nonce }, NOW)
    expect(r.ok && r.state.returnTo).toBe('/')
    expect(r.ok && r.state.exportHref).toBe(null)
  })

  it('uses a fresh nonce each time', () => {
    expect(sign().nonce).not.toBe(sign().nonce)
  })

  it('refuses to sign without a secret', () => {
    expect(() => signState({ ...who, returnTo: '/', exportHref: null }, '')).toThrow()
  })
})

describe('paths', () => {
  it('safeReturnTo keeps app-relative paths only and strips earlier result params', () => {
    expect(safeReturnTo('/reports?tab=projects&driveFile=abc&driveError=x')).toBe('/reports?tab=projects')
    expect(safeReturnTo('/projects/p1?tab=tasks')).toBe('/projects/p1?tab=tasks')
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'reports', '/api/google/drive/export', '/a\nb', 42, null]) {
      expect(safeReturnTo(bad)).toBe(null)
    }
  })

  it('withDriveResult appends the result to a safe path', () => {
    expect(withDriveResult('/reports?tab=tasks', { driveFile: 'abc123' })).toBe('/reports?tab=tasks&driveFile=abc123')
    expect(withDriveResult('https://evil.example', { driveError: 'denied' })).toBe('/?driveError=denied')
  })

  it('parseExportHref accepts only the four export paths', () => {
    expect(parseExportHref('/reports/export?period=month&anchor=2026-10-01&tab=clients')).toMatchObject({ kind: 'time' })
    expect(parseExportHref('/reports/detailed/export?range=all')).toMatchObject({ kind: 'detailed' })
    expect(parseExportHref('/reports/profitability/export')).toMatchObject({ kind: 'profitability', href: '/reports/profitability/export' })
    const t = parseExportHref('/projects/ckabc_123/tasks/export?period=year')
    expect(t).toMatchObject({ kind: 'project_tasks', projectId: 'ckabc_123' })
    expect(t?.params.get('period')).toBe('year')
    for (const bad of ['/reports/expenses/export', '/settings/export', '/projects/../tasks/export', 'https://evil.example/reports/export', '//x/reports/export', '/projects/a b/tasks/export']) {
      expect(parseExportHref(bad)).toBe(null)
    }
  })

  it('isSameOrigin compares the Origin header with the request URL', () => {
    expect(isSameOrigin('https://track2.bigseabridge.com', 'https://track2.bigseabridge.com/api/google/drive/export')).toBe(true)
    expect(isSameOrigin('https://evil.example', 'https://track2.bigseabridge.com/api/google/drive/export')).toBe(false)
    expect(isSameOrigin('null', 'https://track2.bigseabridge.com/x')).toBe(false)
    expect(isSameOrigin(null, 'https://track2.bigseabridge.com/x')).toBe(true)
  })
})

describe('consent URL', () => {
  it('asks for drive.file with offline access and incremental consent', () => {
    const u = new URL(
      buildConsentUrl({ clientId: 'cid', redirectUri: 'https://track2.bigseabridge.com/api/google/drive/callback', state: 's.t', loginHint: 'dzuy@bigsea.co', hostedDomain: 'bigsea.co' }),
    )
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const q = Object.fromEntries(u.searchParams)
    expect(q).toMatchObject({
      client_id: 'cid',
      redirect_uri: 'https://track2.bigseabridge.com/api/google/drive/callback',
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      login_hint: 'dzuy@bigsea.co',
      hd: 'bigsea.co',
      state: 's.t',
    })
    expect(q.scope.split(' ')).toEqual(['openid', 'email', DRIVE_SCOPE])
    expect(q.scope).not.toMatch(/auth\/drive(\s|$)/) // never full Drive
  })

  it('omits hd when there is no single allowed domain', () => {
    expect(new URL(buildConsentUrl({ clientId: 'c', redirectUri: 'r', state: 's' })).searchParams.has('hd')).toBe(false)
  })
})

describe('token endpoint', () => {
  const creds = { clientId: 'cid', clientSecret: 'csecret' }

  it('refreshes an access token with a form POST', async () => {
    const f = vi.fn(async () => jsonResponse(200, { access_token: 'ya29.x', scope: `${DRIVE_SCOPE} openid`, expires_in: 3599 }))
    const r = await refreshAccessToken(f as unknown as typeof fetch, { ...creds, refreshToken: '1//rt' })
    expect(r).toEqual({ ok: true, accessToken: 'ya29.x', refreshToken: null, scope: `${DRIVE_SCOPE} openid`, idToken: null })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    expect(init.method).toBe('POST')
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: '1//rt',
      client_id: 'cid',
      client_secret: 'csecret',
    })
  })

  it('maps invalid_grant (revoked/expired) separately from other failures, without leaking tokens', async () => {
    const revoked = vi.fn(async () => jsonResponse(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }))
    expect(await refreshAccessToken(revoked as unknown as typeof fetch, { ...creds, refreshToken: '1//secret' })).toEqual({
      ok: false,
      error: 'invalid_grant',
      status: 400,
    })
    const down = vi.fn(async () => new Response('<html>oops</html>', { status: 503 }))
    expect(await refreshAccessToken(down as unknown as typeof fetch, { ...creds, refreshToken: '1//secret' })).toEqual({ ok: false, error: 'http', status: 503 })
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const r = await refreshAccessToken(offline as unknown as typeof fetch, { ...creds, refreshToken: '1//secret' })
    expect(r).toEqual({ ok: false, error: 'network' })
    expect(JSON.stringify(r)).not.toContain('secret')
    const empty = vi.fn(async () => jsonResponse(200, {}))
    expect(await refreshAccessToken(empty as unknown as typeof fetch, { ...creds, refreshToken: 'x' })).toEqual({ ok: false, error: 'http', status: 200 })
  })

  it('exchanges a code for refresh + ID tokens', async () => {
    const f = vi.fn(async () => jsonResponse(200, { access_token: 'at', refresh_token: 'rt', scope: DRIVE_SCOPE, id_token: 'a.b.c' }))
    const r = await exchangeCode(f as unknown as typeof fetch, { ...creds, code: '4/abc', redirectUri: 'https://x/cb' })
    expect(r).toEqual({ ok: true, accessToken: 'at', refreshToken: 'rt', scope: DRIVE_SCOPE, idToken: 'a.b.c' })
    const body = Object.fromEntries(new URLSearchParams(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)))
    expect(body).toMatchObject({ grant_type: 'authorization_code', code: '4/abc', redirect_uri: 'https://x/cb' })
  })

  it('revokeToken is best effort', async () => {
    expect(await revokeToken((async () => new Response('', { status: 200 })) as unknown as typeof fetch, 't')).toBe(true)
    expect(
      await revokeToken((async () => {
        throw new Error('x')
      }) as unknown as typeof fetch, 't'),
    ).toBe(false)
  })

  it('hasDriveScope / idTokenEmail', () => {
    expect(hasDriveScope(`openid ${DRIVE_SCOPE} email`)).toBe(true)
    expect(hasDriveScope('openid email https://www.googleapis.com/auth/drive.readonly')).toBe(false)
    const tok = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`
    expect(idTokenEmail(tok({ email: 'Dzuy@BigSea.co', email_verified: true }))).toEqual({ email: 'dzuy@bigsea.co', verified: true })
    expect(idTokenEmail(tok({ email: 'x@bigsea.co' }))).toEqual({ email: 'x@bigsea.co', verified: false })
    expect(idTokenEmail(tok({}))).toBe(null)
    expect(idTokenEmail('nope')).toBe(null)
    expect(idTokenEmail(null)).toBe(null)
  })
})

describe('Drive upload', () => {
  it('builds a multipart request that converts CSV to a Google Sheet', () => {
    const r = buildMultipartUpload({ accessToken: 'at', name: 'Track2 – Time report', csv: 'A,B\r\n1,2', boundary: 'BOUND' })
    expect(r.url).toBe('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink')
    expect(r.init.method).toBe('POST')
    expect(r.init.headers).toEqual({ Authorization: 'Bearer at', 'Content-Type': 'multipart/related; boundary=BOUND' })
    expect(r.init.body).toBe(
      '--BOUND\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
        '{"name":"Track2 – Time report","mimeType":"application/vnd.google-apps.spreadsheet"}' +
        '\r\n--BOUND\r\nContent-Type: text/csv; charset=UTF-8\r\n\r\nA,B\r\n1,2\r\n--BOUND--\r\n',
    )
  })

  it('builds a resumable start for large files', () => {
    const r = buildResumableStart({ accessToken: 'at', name: 'n', byteLength: 123 })
    expect(r.url).toContain('uploadType=resumable')
    expect(r.init.headers).toMatchObject({ 'X-Upload-Content-Type': 'text/csv', 'X-Upload-Content-Length': '123' })
    expect(JSON.parse(r.init.body)).toEqual({ name: 'n', mimeType: 'application/vnd.google-apps.spreadsheet' })
  })

  it('uploads small CSVs in one multipart request', async () => {
    const f = vi.fn(async () => jsonResponse(200, { id: '1AbCdEfGhIjKlMn', webViewLink: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMn/edit' }))
    const r = await uploadCsvAsSheet(f as unknown as typeof fetch, { accessToken: 'at', name: 'n', csv: 'a,b' })
    expect(r).toEqual({ ok: true, fileId: '1AbCdEfGhIjKlMn', webViewLink: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMn/edit' })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('uses a resumable session for CSVs over the multipart limit, and only PUTs to Google', async () => {
    const big = 'x'.repeat(MULTIPART_MAX_BYTES + 1)
    const loc = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=XYZ'
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { Location: loc } }))
      .mockResolvedValueOnce(jsonResponse(200, { id: '1AbCdEfGhIjKlMn' }))
    const r = await uploadCsvAsSheet(f as unknown as typeof fetch, { accessToken: 'at', name: 'n', csv: big })
    expect(r).toEqual({ ok: true, fileId: '1AbCdEfGhIjKlMn', webViewLink: sheetUrl('1AbCdEfGhIjKlMn') })
    expect(f.mock.calls[1][0]).toBe(loc)
    expect(f.mock.calls[1][1].method).toBe('PUT')

    const evil = vi.fn().mockResolvedValueOnce(new Response(null, { status: 200, headers: { Location: 'https://evil.example/upload' } }))
    expect(await uploadCsvAsSheet(evil as unknown as typeof fetch, { accessToken: 'at', name: 'n', csv: big })).toMatchObject({ ok: false, error: 'server' })
    expect(evil).toHaveBeenCalledTimes(1)
  })

  it('maps Drive errors to friendly codes', async () => {
    const at = (status: number) => uploadCsvAsSheet((async () => jsonResponse(status, { error: {} })) as unknown as typeof fetch, { accessToken: 'at', name: 'n', csv: 'a' })
    expect(await at(401)).toEqual({ ok: false, error: 'auth', status: 401 })
    expect(await at(403)).toEqual({ ok: false, error: 'forbidden', status: 403 })
    expect(await at(413)).toEqual({ ok: false, error: 'too_large', status: 413 })
    expect(await at(429)).toEqual({ ok: false, error: 'rate_limited', status: 429 })
    expect(await at(500)).toEqual({ ok: false, error: 'server', status: 500 })
    const thrown = await uploadCsvAsSheet((async () => {
      throw new Error('x')
    }) as unknown as typeof fetch, { accessToken: 'at', name: 'n', csv: 'a' })
    expect(thrown).toEqual({ ok: false, error: 'network' })
    // A success body without a sane file id is treated as a failure.
    const odd = await uploadCsvAsSheet((async () => jsonResponse(200, { id: '../x' })) as unknown as typeof fetch, { accessToken: 'at', name: 'n', csv: 'a' })
    expect(odd).toMatchObject({ ok: false, error: 'server' })
    for (const code of ['auth', 'forbidden', 'too_large', 'export_too_large', 'denied', 'state', 'account_mismatch', 'whatever']) {
      expect(driveErrorMessage(code)).toBeTruthy()
    }
    expect(driveErrorMessage(null)).toBe(null)
  })
})

describe('sheet names', () => {
  it('formats ranges Harvest-style', () => {
    expect(formatRange(d('2026-10-01'), d('2026-10-31'))).toBe('01 Oct–31 Oct 2026')
    expect(formatRange(d('2025-12-15'), d('2026-01-14'))).toBe('15 Dec 2025–14 Jan 2026')
    expect(formatRange(d('2026-10-05'), d('2026-10-05'))).toBe('05 Oct 2026')
    expect(formatRange(null, null)).toBe('All time')
    expect(formatRange(d('2026-10-01'), null)).toBe('From 01 Oct 2026')
    expect(formatRange(null, d('2026-10-31'))).toBe('Through 31 Oct 2026')
  })

  it('builds "Track2 – Report – Group – Range"', () => {
    expect(buildSheetName(['Time report', 'Clients'], { from: d('2026-10-01'), till: d('2026-10-31') })).toBe(
      'Track2 – Time report – Clients – 01 Oct–31 Oct 2026',
    )
    expect(buildSheetName(['Detailed time report', null, ''], { from: null, till: null })).toBe('Track2 – Detailed time report – All time')
    expect(buildSheetName(['[BS-1]  Web\nsite', 'Tasks'], { from: d('2026-01-01'), till: d('2026-12-31') })).toBe(
      'Track2 – [BS-1] Web site – Tasks – 01 Jan–31 Dec 2026',
    )
    expect(buildSheetName(['x'.repeat(500)], { from: null, till: null }).length).toBe(200)
  })

  it('sheetUrl is built from the id', () => {
    expect(sheetUrl('1AbC_d-E')).toBe('https://docs.google.com/spreadsheets/d/1AbC_d-E/edit')
  })
})
