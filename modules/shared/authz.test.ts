/**
 * Authorization matrix (specs/08 §authz, specs/02 §permission model).
 *
 * Locks down the exact capability grid for every base profile, plus override precedence
 * and resource-scoping — the guard that every mutating server action relies on via can().
 */
import { describe, it, expect } from 'vitest'
import {
  can,
  isCapabilityScoped,
  computeOverrides,
  baseHas,
  ALL_CAPABILITIES,
  type Capability,
  type PermissionProfile,
} from './permissions'

describe('computeOverrides (Permissions tab)', () => {
  it('returns no overrides when checked === profile defaults', () => {
    const base = ALL_CAPABILITIES.filter((c) => baseHas('project_manager', c))
    expect(computeOverrides('project_manager', base)).toEqual({})
  })
  it('records a grant for a capability above the profile', () => {
    const base = ALL_CAPABILITIES.filter((c) => baseHas('member', c))
    expect(computeOverrides('member', [...base, 'manage_invoices'])).toEqual({ grant: ['manage_invoices'] })
  })
  it('records a revoke for a capability removed from the profile', () => {
    const base = ALL_CAPABILITIES.filter((c) => baseHas('administrator', c))
    const without = base.filter((c) => c !== 'view_cost_rates')
    expect(computeOverrides('administrator', without)).toEqual({ revoke: ['view_cost_rates'] })
  })
  it('round-trips through can(): computed overrides reproduce the checked set', () => {
    const checked: Capability[] = ['track_own_time', 'manage_invoices', 'run_account_reports']
    const ov = computeOverrides('member', checked)
    const effective = ALL_CAPABILITIES.filter((c) => can({ permissionProfile: 'member', permissionOverrides: ov }, c))
    expect(new Set(effective)).toEqual(new Set(checked))
  })
})

const ALL_CAPS: Capability[] = [
  'edit_account_settings',
  'manage_people',
  'view_billable_rates',
  'view_cost_rates',
  'set_rates',
  'manage_clients',
  'manage_projects',
  'manage_tasks',
  'track_own_time',
  'view_edit_others_time',
  'approve_timesheets',
  'manage_invoices',
  'run_account_reports',
]

// The authoritative grid (from specs/02). Anything not listed for a profile must be denied.
const GRANTED: Record<PermissionProfile, Capability[]> = {
  member: ['track_own_time'],
  project_manager: [
    'track_own_time',
    'manage_clients',
    'manage_projects',
    'manage_tasks',
    'view_edit_others_time',
    'approve_timesheets',
  ],
  people_admin: ['track_own_time', 'manage_people', 'view_edit_others_time', 'approve_timesheets'],
  accounting: ['track_own_time', 'manage_clients', 'view_billable_rates', 'manage_invoices', 'run_account_reports'],
  executive_manager: [
    'track_own_time',
    'manage_people',
    'manage_clients',
    'manage_projects',
    'manage_tasks',
    'view_edit_others_time',
    'approve_timesheets',
    'view_billable_rates',
    'manage_invoices',
    'run_account_reports',
  ],
  administrator: ALL_CAPS,
}

describe('authz capability matrix', () => {
  for (const profile of Object.keys(GRANTED) as PermissionProfile[]) {
    const granted = new Set(GRANTED[profile])
    for (const cap of ALL_CAPS) {
      const expected = granted.has(cap)
      it(`${profile} ${expected ? 'CAN' : 'cannot'} ${cap}`, () => {
        expect(can({ permissionProfile: profile }, cap)).toBe(expected)
      })
    }
  }

  it('administrator holds every capability', () => {
    for (const cap of ALL_CAPS) expect(can({ permissionProfile: 'administrator' }, cap)).toBe(true)
  })

  it('member holds exactly one capability (track_own_time)', () => {
    const held = ALL_CAPS.filter((c) => can({ permissionProfile: 'member' }, c))
    expect(held).toEqual(['track_own_time'])
  })
})

describe('authz overrides', () => {
  it('grant adds a capability the base profile lacks', () => {
    expect(can({ permissionProfile: 'member' }, 'manage_invoices')).toBe(false)
    expect(
      can({ permissionProfile: 'member', permissionOverrides: { grant: ['manage_invoices'] } }, 'manage_invoices'),
    ).toBe(true)
  })

  it('revoke removes a capability the base profile has', () => {
    expect(can({ permissionProfile: 'administrator' }, 'manage_invoices')).toBe(true)
    expect(
      can({ permissionProfile: 'administrator', permissionOverrides: { revoke: ['manage_invoices'] } }, 'manage_invoices'),
    ).toBe(false)
  })

  it('revoke wins over grant when both list the capability', () => {
    expect(
      can(
        { permissionProfile: 'member', permissionOverrides: { grant: ['manage_clients'], revoke: ['manage_clients'] } },
        'manage_clients',
      ),
    ).toBe(false)
  })
})

describe('resource-scoped capabilities', () => {
  it('project_manager time/approval capabilities are resource-scoped', () => {
    expect(isCapabilityScoped({ permissionProfile: 'project_manager' }, 'view_edit_others_time')).toBe(true)
    expect(isCapabilityScoped({ permissionProfile: 'project_manager' }, 'approve_timesheets')).toBe(true)
  })

  it('the same capabilities are account-wide (not scoped) for executive_manager', () => {
    expect(isCapabilityScoped({ permissionProfile: 'executive_manager' }, 'view_edit_others_time')).toBe(false)
  })

  it('non-scoped capabilities report unscoped for everyone', () => {
    expect(isCapabilityScoped({ permissionProfile: 'project_manager' }, 'manage_projects')).toBe(false)
    expect(isCapabilityScoped({ permissionProfile: 'administrator' }, 'manage_invoices')).toBe(false)
  })
})
