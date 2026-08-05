import { describe, it, expect } from 'vitest'
import { can, isCapabilityScoped, type Actor, type PermissionProfile } from './permissions'

const actor = (permissionProfile: PermissionProfile, overrides?: Actor['permissionOverrides']): Actor => ({
  permissionProfile,
  permissionOverrides: overrides,
})

describe('can', () => {
  it('AC-AUTH-004: Project Manager cannot manage invoices; Accounting can', () => {
    expect(can(actor('project_manager'), 'manage_invoices')).toBe(false)
    expect(can(actor('accounting'), 'manage_invoices')).toBe(true)
    expect(can(actor('administrator'), 'manage_invoices')).toBe(true)
  })

  it('AC-AUTH-004b: cost rates are Administrator-only; billable rates for accounting/exec/admin', () => {
    for (const p of ['member', 'project_manager', 'people_admin', 'accounting', 'executive_manager'] as PermissionProfile[]) {
      expect(can(actor(p), 'view_cost_rates')).toBe(false)
    }
    expect(can(actor('administrator'), 'view_cost_rates')).toBe(true)

    expect(can(actor('accounting'), 'view_billable_rates')).toBe(true)
    expect(can(actor('executive_manager'), 'view_billable_rates')).toBe(true)
    expect(can(actor('administrator'), 'view_billable_rates')).toBe(true)
    expect(can(actor('member'), 'view_billable_rates')).toBe(false)
    expect(can(actor('project_manager'), 'view_billable_rates')).toBe(false)
  })

  it('only Administrator can edit account settings', () => {
    expect(can(actor('administrator'), 'edit_account_settings')).toBe(true)
    expect(can(actor('executive_manager'), 'edit_account_settings')).toBe(false)
  })

  it('every profile can track their own time', () => {
    for (const p of ['member', 'project_manager', 'people_admin', 'accounting', 'executive_manager', 'administrator'] as PermissionProfile[]) {
      expect(can(actor(p), 'track_own_time')).toBe(true)
    }
  })

  it('a member has no management capabilities', () => {
    expect(can(actor('member'), 'manage_projects')).toBe(false)
    expect(can(actor('member'), 'manage_people')).toBe(false)
    expect(can(actor('member'), 'view_edit_others_time')).toBe(false)
  })

  it('overrides win over the base profile (grant and revoke)', () => {
    expect(can(actor('member', { grant: ['manage_invoices'] }), 'manage_invoices')).toBe(true)
    expect(can(actor('accounting', { revoke: ['manage_invoices'] }), 'manage_invoices')).toBe(false)
    // revoke takes precedence when both are present
    expect(can(actor('member', { grant: ['manage_invoices'], revoke: ['manage_invoices'] }), 'manage_invoices')).toBe(false)
  })
})

describe('isCapabilityScoped', () => {
  it('Project Manager time/approval capabilities are resource-scoped', () => {
    expect(isCapabilityScoped(actor('project_manager'), 'view_edit_others_time')).toBe(true)
    expect(isCapabilityScoped(actor('project_manager'), 'approve_timesheets')).toBe(true)
    // account-wide for these profiles
    expect(isCapabilityScoped(actor('people_admin'), 'view_edit_others_time')).toBe(false)
    expect(isCapabilityScoped(actor('administrator'), 'approve_timesheets')).toBe(false)
  })
})
