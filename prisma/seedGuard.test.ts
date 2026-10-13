import { describe, expect, it } from 'vitest'
import { dbHostOf, evaluateSeedTargets, type SeedTargetStats } from './seedGuard'

const demo = (over: Partial<SeedTargetStats> = {}): SeedTargetStats => ({
  accountId: 'acc_demo', name: 'Big Sea (demo)', timeEntries: 40, invoices: 2, users: 8, migrationIdMaps: 0, migrationSnapshots: 0, ...over,
})

describe('evaluateSeedTargets', () => {
  it('refuses without ALLOW_SEED=1 even on an empty database', () => {
    expect(evaluateSeedTargets(undefined, []).ok).toBe(false)
    expect(evaluateSeedTargets('true', []).ok).toBe(false)
  })

  it('allows a fresh database or demo-sized accounts when opted in', () => {
    expect(evaluateSeedTargets('1', [])).toEqual({ ok: true })
    expect(evaluateSeedTargets('1', [demo(), demo({ accountId: 'acc_globex', name: 'Globex' })])).toEqual({ ok: true })
  })

  it('refuses the production shape: 388k entries, 7.8k invoices, Harvest id-maps', () => {
    const v = evaluateSeedTargets('1', [demo({ timeEntries: 388_607, invoices: 7_788, users: 130, migrationIdMaps: 12_000, migrationSnapshots: 2 })])
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.reasons).toHaveLength(5)
      expect(v.reasons[0]).toContain('388,607 time entries')
    }
  })

  it('refuses on a single migration marker even when the account is small', () => {
    expect(evaluateSeedTargets('1', [demo({ migrationIdMaps: 1 })]).ok).toBe(false)
    expect(evaluateSeedTargets('1', [demo({ timeEntries: 1001 })]).ok).toBe(false)
    expect(evaluateSeedTargets('1', [demo({ timeEntries: 1000 })]).ok).toBe(true)
  })
})

describe('dbHostOf', () => {
  it('prints host and database without credentials', () => {
    expect(dbHostOf('postgresql://postgres:s3cret@db.example.com:5432/postgres?sslmode=require')).toBe('db.example.com:5432/postgres')
    expect(dbHostOf(undefined)).toContain('not set')
  })
})
