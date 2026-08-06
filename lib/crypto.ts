import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'

/**
 * Symmetric encryption for integration secrets at rest (specs/14 §security).
 *
 * AES-256-GCM. The key is derived (SHA-256) from the INTEGRATION_ENC_KEY env var so any
 * sufficiently-long passphrase works. Ciphertext is stored as `v1:<iv>:<tag>:<data>`
 * (all base64). Secrets are NEVER logged or returned to the client — only encrypt/decrypt
 * happen server-side.
 */

function key(): Buffer {
  const secret = process.env.INTEGRATION_ENC_KEY
  if (!secret || secret.length < 16) {
    throw new Error('INTEGRATION_ENC_KEY is not set (min 16 chars) — cannot store integration secrets.')
  }
  return createHash('sha256').update(secret).digest() // 32 bytes
}

export function isEncryptionConfigured(): boolean {
  const secret = process.env.INTEGRATION_ENC_KEY
  return !!secret && secret.length >= 16
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Malformed ciphertext.')
  const [, ivB64, tagB64, dataB64] = parts
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}

/** Last 4 visible for display, e.g. "sk_live_…6a1c" → "••••6a1c". Never reveals the secret. */
export function maskSecret(plaintext: string): string {
  const tail = plaintext.slice(-4)
  return `••••${tail}`
}
