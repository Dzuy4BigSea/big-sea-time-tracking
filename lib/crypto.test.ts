import { describe, it, expect, beforeAll } from 'vitest'
import { encryptSecret, decryptSecret, maskSecret, isEncryptionConfigured } from './crypto'

beforeAll(() => {
  process.env.INTEGRATION_ENC_KEY = 'test-integration-encryption-key-0123456789'
})

describe('integration secret crypto', () => {
  it('round-trips a secret', () => {
    const secret = 'sk_live_abcdef0123456789'
    const enc = encryptSecret(secret)
    expect(enc).not.toContain(secret)
    expect(enc.startsWith('v1:')).toBe(true)
    expect(decryptSecret(enc)).toBe(secret)
  })

  it('produces different ciphertext each time (random IV)', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
  })

  it('rejects tampered ciphertext (GCM auth tag)', () => {
    const enc = encryptSecret('whsec_topsecret')
    const parts = enc.split(':')
    const badData = Buffer.from(parts[3], 'base64')
    badData[0] ^= 0xff
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${badData.toString('base64')}`
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('masks to last 4', () => {
    expect(maskSecret('sk_live_xxxx6a1c')).toBe('••••6a1c')
  })

  it('reports configured when key present', () => {
    expect(isEncryptionConfigured()).toBe(true)
  })
})
