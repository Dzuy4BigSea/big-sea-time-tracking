import { describe, it, expect } from 'vitest'
import { timeReadScope, resolveUserFilter, canSeeRates, canWriteForOthers } from './scope'
import type { Actor } from '@/modules/shared/permissions'

const actor = (permissionProfile: Actor['permissionProfile'], permissionOverrides?: Actor['permissionOverrides']): Actor => ({ permissionProfile, permissionOverrides })

describe('API permission mapping (same capability model as the UI)', () => {
  it('maps profiles to read scopes', () => {
    expect(timeReadScope(actor('member'))).toBe('self')
    expect(timeReadScope(actor('project_manager'))).toBe('managed')
    expect(timeReadScope(actor('people_admin'))).toBe('all')
    expect(timeReadScope(actor('accounting'))).toBe('all') // run_account_reports
    expect(timeReadScope(actor('executive_manager'))).toBe('all')
    expect(timeReadScope(actor('administrator'))).toBe('all')
  })

  it('honours per-user overrides', () => {
    expect(timeReadScope(actor('member', { grant: ['view_edit_others_time'] }))).toBe('all')
    expect(timeReadScope(actor('administrator', { revoke: ['view_edit_others_time', 'run_account_reports'] }))).toBe('self')
  })

  it('a member cannot read other people’s time', () => {
    expect(() => resolveUserFilter('self', 'me', ['someone'])).toThrow(/only read your own/)
    expect(() => resolveUserFilter('self', 'me', ['me', 'someone'])).toThrow()
    expect(resolveUserFilter('self', 'me', undefined)).toEqual({ userIds: ['me'], managedOnly: false, scopeLimited: false })
    expect(resolveUserFilter('self', 'me', ['me'])).toEqual({ userIds: ['me'], managedOnly: false, scopeLimited: false })
  })

  it('a project manager sees own + managed-project rows, flagged scope_limited', () => {
    expect(resolveUserFilter('managed', 'pm', undefined)).toEqual({ userIds: undefined, managedOnly: true, scopeLimited: true })
    expect(resolveUserFilter('managed', 'pm', ['x', 'x'])).toEqual({ userIds: ['x'], managedOnly: true, scopeLimited: true })
    expect(resolveUserFilter('managed', 'pm', ['pm'])).toEqual({ userIds: ['pm'], managedOnly: false, scopeLimited: false })
  })

  it('account-wide readers are not limited', () => {
    expect(resolveUserFilter('all', 'a', ['x'])).toEqual({ userIds: ['x'], managedOnly: false, scopeLimited: false })
    expect(resolveUserFilter('all', 'a', [])).toEqual({ userIds: undefined, managedOnly: false, scopeLimited: false })
  })

  it('rates and acting for others follow capabilities', () => {
    expect(canSeeRates(actor('member'))).toBe(false)
    expect(canSeeRates(actor('project_manager'))).toBe(false)
    expect(canSeeRates(actor('accounting'))).toBe(true)
    expect(canWriteForOthers(actor('member'))).toBe(false)
    expect(canWriteForOthers(actor('project_manager'))).toBe(true)
    expect(canWriteForOthers(actor('accounting'))).toBe(false)
  })
})
