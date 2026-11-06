import { describe, it, expect, vi } from 'vitest'

// Acting on one's own time needs no DB lookup; a call here means the self path leaked into the others path.
vi.mock('@/lib/prisma', () => ({ prisma: new Proxy({}, { get: () => { throw new Error('unexpected DB access') } }) }))
vi.mock('@/lib/session', () => ({}))

import { mayActForOnProject } from './timesheetSubject'
import type { CurrentUser } from './session'

const me = (permissionOverrides: CurrentUser['permissionOverrides'] = null): CurrentUser => ({
  userId: 'u1',
  accountId: 'a1',
  permissionProfile: 'member',
  permissionOverrides,
})

describe('mayActForOnProject (own time / expenses)', () => {
  it('lets anyone with track_own_time change their own entries', async () => {
    expect(await mayActForOnProject(me(), 'u1', 'p1')).toBe(true)
  })

  it('blocks own entries when track_own_time is revoked on the Permissions tab', async () => {
    expect(await mayActForOnProject(me({ revoke: ['track_own_time'] }), 'u1', 'p1')).toBe(false)
  })
})
