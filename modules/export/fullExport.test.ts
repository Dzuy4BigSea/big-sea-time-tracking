import { describe, expect, it } from 'vitest'
import { EXPORT_TABLES, isExportTable, isSecretColumn } from './fullExport'

describe('full export', () => {
  it('never exports secrets', () => {
    expect(isSecretColumn('passwordHash')).toBe(true)
    expect(isSecretColumn('publicToken')).toBe(true)
    expect(isSecretColumn('secretsEnc')).toBe(true)
    expect(isSecretColumn('email')).toBe(false)
    expect(isSecretColumn('stripePaymentIntentId')).toBe(false)
  })

  it('only allows the whitelisted tables', () => {
    expect(isExportTable('time-entries')).toBe(true)
    expect(isExportTable('people')).toBe(true)
    expect(isExportTable('IntegrationConnection')).toBe(false)
    expect(isExportTable('__proto__')).toBe(false)
    expect(Object.keys(EXPORT_TABLES)).toHaveLength(9)
  })
})
