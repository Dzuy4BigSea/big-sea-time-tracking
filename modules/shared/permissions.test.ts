import { describe, it, expect } from 'vitest'
import { can, isCapabilityScoped, isAccountAdmin, outranks, checkAccessChange, checkSecurityChange, projectManagementScoped, type Actor, type PermissionProfile } from './permissions'

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

describe('escalation guards', () => {
  const admin = actor('administrator')
  const peopleAdmin = actor('people_admin')
  const exec = actor('executive_manager')

  it('only administrators can assign the Administrator profile', () => {
    expect(checkAccessChange(peopleAdmin, actor('member'), actor('administrator'))).toMatch(/administrator/i)
    expect(checkAccessChange(exec, actor('member'), actor('administrator'))).toMatch(/administrator/i)
    expect(checkAccessChange(exec, null, actor('administrator'))).toMatch(/administrator/i)
    expect(checkAccessChange(admin, actor('member'), actor('administrator'))).toBeNull()
  })

  it('non-admins cannot grant capabilities they lack (profile or override)', () => {
    expect(checkAccessChange(peopleAdmin, actor('member'), actor('accounting'))).toMatch(/can’t grant/)
    expect(checkAccessChange(peopleAdmin, actor('member'), actor('member', { grant: ['set_rates'] }))).toMatch(/can’t grant/)
    expect(checkAccessChange(exec, actor('member'), actor('member', { grant: ['edit_account_settings'] }))).toMatch(/can’t grant/)
    expect(checkAccessChange(peopleAdmin, actor('member'), actor('member', { grant: ['approve_timesheets'] }))).toBeNull()
    expect(checkAccessChange(exec, actor('member'), actor('accounting'))).toBeNull()
  })

  it('non-admins cannot modify someone who outranks them', () => {
    expect(checkAccessChange(exec, actor('administrator'), actor('member'))).toMatch(/administrator/i)
    expect(checkAccessChange(peopleAdmin, actor('accounting'), actor('member'))).toMatch(/administrator/i)
    expect(checkAccessChange(admin, actor('administrator'), actor('member'))).toBeNull()
  })

  it('requires manage_people', () => {
    expect(checkAccessChange(actor('member'), actor('member'), actor('member'))).toMatch(/permission/)
    expect(checkAccessChange(actor('member', { grant: ['manage_people'] }), actor('member'), actor('member'))).toBeNull()
  })

  it('security changes on higher-privileged people are admin-only', () => {
    expect(checkSecurityChange(exec, actor('administrator'), false)).toMatch(/administrator/i)
    expect(checkSecurityChange(peopleAdmin, actor('accounting'), false)).toMatch(/administrator/i)
    expect(checkSecurityChange(peopleAdmin, actor('member'), false)).toBeNull()
    expect(checkSecurityChange(peopleAdmin, actor('people_admin'), true)).toBeNull()
    expect(checkSecurityChange(admin, actor('administrator'), false)).toBeNull()
    expect(checkSecurityChange(actor('member'), actor('member'), false)).toMatch(/permission/)
  })

  it('a revoked edit_account_settings admin is not treated as an account admin', () => {
    const demoted = actor('administrator', { revoke: ['edit_account_settings'] })
    expect(isAccountAdmin(demoted)).toBe(false)
    expect(outranks(actor('administrator'), demoted)).toBe(true)
  })
})

describe('projectManagementScoped', () => {
  it('PMs are limited to projects they manage; exec/admin are account-wide', () => {
    expect(projectManagementScoped(actor('project_manager'))).toBe(true)
    expect(projectManagementScoped(actor('project_manager', { grant: ['edit_account_settings'] }))).toBe(false)
    expect(projectManagementScoped(actor('executive_manager'))).toBe(false)
    expect(projectManagementScoped(actor('administrator'))).toBe(false)
  })
})
