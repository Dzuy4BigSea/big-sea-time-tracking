/**
 * Client authentication at the token / revocation endpoints (specs/22 §OAuth). Public clients
 * (`none`) identify with client_id only — PKCE protects the code. Clients registered with a secret
 * must present it (client_secret_post in the body, or client_secret_basic in Authorization: Basic);
 * the check is constant-time against the stored SHA-256.
 */
import { verifySecret } from './crypto'

export interface ClientCredentials {
  clientId: string | undefined
  clientSecret: string | undefined
  /** Which mechanism carried the credentials. */
  via: 'body' | 'basic' | 'none'
}

/** Pull client_id / client_secret from an Authorization: Basic header or the form body. */
export function clientCredentials(authorization: string | null, form: Record<string, string>): ClientCredentials | { error: string } {
  const m = authorization ? /^\s*basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(authorization) : null
  if (m) {
    let decoded: string
    try {
      decoded = Buffer.from(m[1], 'base64').toString('utf8')
    } catch {
      return { error: 'Malformed Basic credentials' }
    }
    const i = decoded.indexOf(':')
    if (i < 0) return { error: 'Malformed Basic credentials' }
    let id: string
    let secret: string
    try {
      id = decodeURIComponent(decoded.slice(0, i).replace(/\+/g, ' '))
      secret = decodeURIComponent(decoded.slice(i + 1).replace(/\+/g, ' '))
    } catch {
      return { error: 'Malformed Basic credentials' }
    }
    if (form.client_id && form.client_id !== id) return { error: 'client_id mismatch' }
    if (form.client_secret) return { error: 'Use one client authentication method' }
    return { clientId: id, clientSecret: secret, via: 'basic' }
  }
  return { clientId: form.client_id || undefined, clientSecret: form.client_secret || undefined, via: form.client_secret ? 'body' : 'none' }
}

export function clientAuthenticates(client: { clientSecretHash: string | null }, creds: ClientCredentials): boolean {
  if (!client.clientSecretHash) {
    // Public client: must not pretend to have a secret.
    return creds.clientSecret === undefined
  }
  return !!creds.clientSecret && verifySecret(creds.clientSecret, client.clientSecretHash)
}
