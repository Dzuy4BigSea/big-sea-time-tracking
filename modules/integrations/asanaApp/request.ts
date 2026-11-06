/**
 * Asana App Components request checks (specs/29 §3, AC-ASANAAPP-001). Pure + DB-free → unit-tested.
 *
 * Asana signs every call with the app's client secret: `x-asana-request-signature` is the hex
 * HMAC-SHA256 of the raw query string (GET, without the leading "?") or of the `data` string inside the
 * JSON body (POST). Each call also carries `expires_at`; a call past it must be refused.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export const ASANA_ORIGIN = 'https://app.asana.com'
export const SIGNATURE_HEADER = 'x-asana-request-signature'

export function signAsanaPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
}

export function verifyAsanaSignature(payload: string, signature: string | null | undefined, secret: string): boolean {
  if (!secret || !signature || !/^[0-9a-f]{64}$/i.test(signature.trim())) return false
  const given = Buffer.from(signature.trim().toLowerCase(), 'hex')
  const want = Buffer.from(signAsanaPayload(payload, secret), 'hex')
  return given.length === want.length && timingSafeEqual(given, want)
}

/** `expires_at` is documented both as epoch milliseconds and as ISO 8601; accept either. */
export function parseExpiresAt(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim()
  if (/^\d+$/.test(s)) return Number(s)
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}

export function isExpired(expiresAt: unknown, now: number): boolean {
  const t = parseExpiresAt(expiresAt)
  return t == null || now > t
}

/** The fields every Asana call carries, plus the form's values on change/submit. */
export interface AsanaCall {
  workspace: string
  user: string
  task: string | null
  attachment: string | null
  resourceUrl: string | null
  query: string | null
  values: Record<string, unknown>
  changedField: string | null
  expiresAt: unknown
}

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v))

function toCall(o: Record<string, unknown>): AsanaCall | null {
  const workspace = str(o.workspace)
  const user = str(o.user)
  if (!workspace || !user) return null
  return {
    workspace,
    user,
    task: str(o.task),
    attachment: str(o.attachment),
    resourceUrl: str(o.resource_url),
    query: str(o.query),
    values: o.values && typeof o.values === 'object' && !Array.isArray(o.values) ? (o.values as Record<string, unknown>) : {},
    changedField: str(o.changed_field),
    expiresAt: o.expires_at,
  }
}

export type CheckedCall = { ok: true; call: AsanaCall } | { ok: false; status: 400; reason: 'signature' | 'expired' | 'malformed' }

/** GET: verify the raw query string, then read the params. */
export function checkGet(rawQuery: string, signature: string | null, secret: string, now: number): CheckedCall {
  if (!verifyAsanaSignature(rawQuery, signature, secret)) return { ok: false, status: 400, reason: 'signature' }
  const call = toCall(Object.fromEntries(new URLSearchParams(rawQuery)))
  if (!call) return { ok: false, status: 400, reason: 'malformed' }
  if (isExpired(call.expiresAt, now)) return { ok: false, status: 400, reason: 'expired' }
  return { ok: true, call }
}

/**
 * POST: the body is JSON `{ "data": "<json string>" }` and the signature covers that string. A body
 * with the fields at the top level (as Asana's reference draws it) is signed over the raw body.
 */
export function checkPost(rawBody: string, signature: string | null, secret: string, now: number): CheckedCall {
  let outer: unknown
  try {
    outer = JSON.parse(rawBody)
  } catch {
    return { ok: false, status: 400, reason: 'malformed' }
  }
  const wrapped = outer && typeof outer === 'object' && typeof (outer as { data?: unknown }).data === 'string'
  const signed = wrapped ? (outer as { data: string }).data : rawBody
  if (!verifyAsanaSignature(signed, signature, secret)) return { ok: false, status: 400, reason: 'signature' }
  let inner: unknown = outer
  if (wrapped) {
    try {
      inner = JSON.parse(signed)
    } catch {
      return { ok: false, status: 400, reason: 'malformed' }
    }
  }
  const call = inner && typeof inner === 'object' ? toCall(inner as Record<string, unknown>) : null
  if (!call) return { ok: false, status: 400, reason: 'malformed' }
  if (isExpired(call.expiresAt, now)) return { ok: false, status: 400, reason: 'expired' }
  return { ok: true, call }
}

/** CORS for calls made from the user's browser on app.asana.com. */
export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ASANA_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': `Content-Type, ${SIGNATURE_HEADER}`,
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}
