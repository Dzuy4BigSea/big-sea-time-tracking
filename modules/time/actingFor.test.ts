import { describe, it, expect } from 'vitest'
import { canActFor, canActForOthers, loggableProjectError, type ActForInput } from './actingFor'
import type { PermissionProfile } from '@/modules/shared/permissions'

const base = (over: Partial<ActForInput> = {}): ActForInput => ({
  actor: { permissionProfile: 'member' },
  actorUserId: 'me',
  actorAccountId: 'acct',
  targetUserId: 'them',
  targetAccountId: 'acct',
  targetIsManaged: false,
  ...over,
})
const as = (p: PermissionProfile, over: Partial<ActForInput> = {}) => base({ actor: { permissionProfile: p }, ...over })

describe('canActFor (timesheet person switcher)', () => {
  it('always allows acting for yourself, whatever the profile', () => {
    expect(canActFor(base({ targetUserId: 'me' }))).toBe(true)
  })
  it('rejects a self id that is not in the actor account', () => {
    expect(canActFor(base({ targetUserId: 'me', targetAccountId: 'other' }))).toBe(false)
  })
  it('members cannot act for others', () => {
    expect(canActFor(as('member'))).toBe(false)
    expect(canActFor(as('accounting'))).toBe(false)
  })
  it('admins, executive managers and people admins can act for anyone in the account', () => {
    for (const p of ['administrator', 'executive_manager', 'people_admin'] as const) {
      expect(canActFor(as(p))).toBe(true)
    }
  })
  it('never crosses accounts (INV-5), even for admins', () => {
    expect(canActFor(as('administrator', { targetAccountId: 'other' }))).toBe(false)
    expect(canActFor(as('administrator', { targetAccountId: null }))).toBe(false)
  })
  it('project managers are scoped to people on projects they manage', () => {
    expect(canActFor(as('project_manager', { targetIsManaged: true }))).toBe(true)
    expect(canActFor(as('project_manager', { targetIsManaged: false }))).toBe(false)
  })
  it('honors per-user overrides', () => {
    const revoked = base({ actor: { permissionProfile: 'administrator', permissionOverrides: { revoke: ['view_edit_others_time'] } } })
    expect(canActFor(revoked)).toBe(false)
    const granted = base({ actor: { permissionProfile: 'member', permissionOverrides: { grant: ['view_edit_others_time'] } } })
    expect(canActFor(granted)).toBe(true)
  })
  it('canActForOthers gates the switcher', () => {
    expect(canActForOthers({ permissionProfile: 'member' })).toBe(false)
    expect(canActForOthers({ permissionProfile: 'project_manager' })).toBe(true)
    expect(canActForOthers({ permissionProfile: 'administrator' })).toBe(true)
  })
})

describe('loggableProjectError (no new time on archived projects)', () => {
  const active = { accountId: 'acct', isActive: true, archivedAt: null, client: { isActive: true, archivedAt: null } }
  it('accepts an active project of an active client', () => {
    expect(loggableProjectError(active, 'acct')).toBeNull()
  })
  it('rejects a missing or other-account project', () => {
    expect(loggableProjectError(null, 'acct')).toMatch(/not found/)
    expect(loggableProjectError(active, 'other')).toMatch(/not found/)
  })
  it('rejects an archived project', () => {
    expect(loggableProjectError({ ...active, isActive: false }, 'acct')).toMatch(/archived/)
    expect(loggableProjectError({ ...active, archivedAt: new Date() }, 'acct')).toMatch(/archived/)
  })
  it('rejects a project whose client is archived', () => {
    expect(loggableProjectError({ ...active, client: { isActive: false, archivedAt: new Date() } }, 'acct')).toMatch(/client/)
  })
})
