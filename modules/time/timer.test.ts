import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/modules/time/logTime', () => ({
  resolveEntryRate: vi.fn(async () => ({ accountId: 'acc', isBillable: true, billableRateCents: 15000 })),
}))

import { startTimer, stopTimer } from './timer'

/** A minimal in-memory stand-in for the Prisma calls the timer service makes. */
function fakePrisma(opts: { running?: Record<string, unknown> | null; failCreateWith?: unknown } = {}) {
  let running = opts.running ?? null
  const created: Record<string, unknown>[] = []
  const audits: Record<string, unknown>[] = []
  const updates: Record<string, unknown>[] = []
  const tx = {
    timeEntry: {
      findFirst: vi.fn(async () => running),
      updateMany: vi.fn(async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data)
        const had = running ? 1 : 0
        running = null
        return { count: had }
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (opts.failCreateWith) throw opts.failCreateWith
        const e = { id: `te_${created.length + 1}`, ...data }
        created.push(e)
        return e
      }),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => audits.push(data)) },
  }
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  }
  return {
    prisma: prisma as unknown as PrismaClient,
    created,
    audits,
    updates,
    setRunning: (r: Record<string, unknown> | null) => (running = r),
  }
}

const base = { userId: 'u1', projectId: 'p1', taskId: 'k1' }
// 23:30 Eastern on Tue 13 Oct 2026 = 03:30 UTC Wed 14 Oct.
const LATE_ET = new Date('2026-10-14T03:30:00Z')

describe('startTimer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('dates the entry today in the account timezone (23:30 ET → the ET day, not the UTC day)', async () => {
    const f = fakePrisma()
    const r = await startTimer(f.prisma, { ...base, now: LATE_ET, timezone: 'America/New_York' })
    expect(r.alreadyRunning).toBe(false)
    expect((f.created[0].spentDate as Date).toISOString().slice(0, 10)).toBe('2026-10-13')
    expect(f.audits).toHaveLength(1)
    expect(f.audits[0]).toMatchObject({ entityType: 'time_entry', action: 'create', actorUserId: 'u1' })
  })

  it('an explicit spentDate wins', async () => {
    const f = fakePrisma()
    await startTimer(f.prisma, { ...base, now: LATE_ET, timezone: 'America/New_York', spentDate: new Date('2026-10-10T00:00:00Z') })
    expect((f.created[0].spentDate as Date).toISOString().slice(0, 10)).toBe('2026-10-10')
  })

  it('a double-click (same project/task, seconds apart) is a no-op success', async () => {
    const running = { id: 'te_r', accountId: 'acc', userId: 'u1', projectId: 'p1', taskId: 'k1', minutes: 0, notes: null, spentDate: new Date('2026-10-13T00:00:00Z'), isRunning: true, timerStartedAt: new Date(LATE_ET.getTime() - 2000) }
    const f = fakePrisma({ running })
    const r = await startTimer(f.prisma, { ...base, now: LATE_ET, timezone: 'America/New_York' })
    expect(r).toEqual({ entry: running, alreadyRunning: true })
    expect(f.created).toHaveLength(0)
    expect(f.updates).toHaveLength(0)
  })

  it('a lost race on one_running_timer_per_user (P2002) returns the running timer instead of crashing', async () => {
    const winner = { id: 'te_w', userId: 'u1', isRunning: true }
    const f = fakePrisma({ failCreateWith: Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }) })
    // Inside the tx nothing was running yet; after the failed tx, the winner's timer is visible.
    ;(f.prisma.timeEntry.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null).mockResolvedValueOnce(winner)
    const r = await startTimer(f.prisma, { ...base, now: LATE_ET })
    expect(r).toEqual({ entry: winner, alreadyRunning: true })
  })

  it('other errors still throw', async () => {
    const f = fakePrisma({ failCreateWith: new Error('db down') })
    await expect(startTimer(f.prisma, { ...base, now: LATE_ET })).rejects.toThrow('db down')
  })

  it('stops a different running timer first, capped at 12h, and audits both (actor ≠ subject)', async () => {
    const running = { id: 'te_old', accountId: 'acc', userId: 'u1', projectId: 'p9', taskId: 'k9', minutes: 30, notes: 'x', spentDate: new Date('2026-10-12T00:00:00Z'), isRunning: true, timerStartedAt: new Date('2026-10-12T13:00:00Z') }
    const f = fakePrisma({ running })
    await startTimer(f.prisma, { ...base, now: LATE_ET, actorUserId: 'pm' })
    expect(f.updates[0]).toMatchObject({ isRunning: false, minutes: { increment: 720 } })
    expect(f.audits.map((a) => a.action)).toEqual(['state_change', 'create'])
    expect(f.audits[0]).toMatchObject({ actorUserId: 'pm', after: expect.objectContaining({ subjectUserId: 'u1', actedForTeammate: true, minutes: 750 }) })
  })
})

describe('stopTimer', () => {
  it('returns null (no-op) when nothing is running — a second Stop click', async () => {
    const f = fakePrisma()
    expect(await stopTimer(f.prisma, { userId: 'u1', now: LATE_ET })).toBeNull()
    expect(f.audits).toHaveLength(0)
  })
  it('finalizes minutes and audits before/after', async () => {
    const running = { id: 'te_r', accountId: 'acc', userId: 'u1', projectId: 'p1', taskId: 'k1', minutes: 10, notes: null, spentDate: new Date('2026-10-13T00:00:00Z'), isRunning: true, timerStartedAt: new Date(LATE_ET.getTime() - 45 * 60_000) }
    const f = fakePrisma({ running })
    const e = await stopTimer(f.prisma, { userId: 'u1', now: LATE_ET })
    expect(e?.minutes).toBe(55)
    expect(f.audits[0]).toMatchObject({ action: 'state_change', before: expect.objectContaining({ minutes: 10, isRunning: true }), after: expect.objectContaining({ minutes: 55, isRunning: false }) })
  })
})
