import { describe, it, expect } from 'vitest'
import { _mappers } from './importer'

const {
  cents, centsOrNull, minutesFromHours, dateOnly, trailingInt,
  mapPermission, mapBillMethod, mapProjectType, mapBudget,
  mapInvoiceStatus, mapEstimateStatus, mapPaymentTerm,
} = _mappers

describe('money + unit conversion', () => {
  it('cents rounds dollars to integer cents, null/blank → 0', () => {
    expect(cents(12.34)).toBe(1234)
    expect(cents('9.99')).toBe(999)
    expect(cents(1000.5)).toBe(100050)
    expect(cents(0)).toBe(0)
    expect(cents(null)).toBe(0)
    expect(cents('')).toBe(0)
  })
  it('centsOrNull preserves null (absent) but converts present values', () => {
    expect(centsOrNull(null)).toBeNull()
    expect(centsOrNull('')).toBeNull()
    expect(centsOrNull(0)).toBe(0)
    expect(centsOrNull(150)).toBe(15000)
  })
  it('minutesFromHours converts decimal hours to whole minutes', () => {
    expect(minutesFromHours(1)).toBe(60)
    expect(minutesFromHours(1.5)).toBe(90)
    expect(minutesFromHours(0.25)).toBe(15)
    expect(minutesFromHours(8.15)).toBe(489) // 8.15h = 489m
    expect(minutesFromHours(null)).toBe(0)
  })
})

describe('date + number parsing', () => {
  it('dateOnly parses YYYY-MM-DD at UTC midnight, null passthrough', () => {
    expect(dateOnly('2024-03-15')?.toISOString()).toBe('2024-03-15T00:00:00.000Z')
    expect(dateOnly('2024-03-15T09:30:00Z')?.toISOString()).toBe('2024-03-15T00:00:00.000Z')
    expect(dateOnly(null)).toBeNull()
    expect(dateOnly('')).toBeNull()
  })
  it('trailingInt extracts a trailing number for sequence bumping', () => {
    expect(trailingInt('1042')).toBe(1042)
    expect(trailingInt('INV-2024-0007')).toBe(7)
    expect(trailingInt('EST5')).toBe(5)
    expect(trailingInt(null)).toBeNull()
    expect(trailingInt('no-digits')).toBeNull()
  })
})

describe('enum mapping', () => {
  it('maps Harvest permission flags', () => {
    expect(mapPermission({ is_admin: true })).toBe('administrator')
    expect(mapPermission({ is_project_manager: true })).toBe('project_manager')
    expect(mapPermission({})).toBe('member')
    expect(mapPermission({ access_roles: ['administrator'] })).toBe('administrator')
  })
  it('maps bill_by to billable rate method', () => {
    expect(mapBillMethod('Project')).toBe('project')
    expect(mapBillMethod('People')).toBe('person')
    expect(mapBillMethod('Tasks')).toBe('task')
    expect(mapBillMethod('none')).toBe('none')
    expect(mapBillMethod(undefined)).toBe('none')
  })
  it('classifies project type', () => {
    expect(mapProjectType({ is_billable: false })).toBe('non_billable')
    expect(mapProjectType({ is_billable: true, fee: 5000 })).toBe('fixed_fee')
    expect(mapProjectType({ is_billable: true })).toBe('time_and_materials')
  })
  it('maps budget method + converts value units', () => {
    expect(mapBudget({ budget_by: 'project', budget: 100 })).toEqual({ method: 'hours_total', value: 6000 })
    expect(mapBudget({ budget_by: 'task', budget: 40 })).toEqual({ method: 'hours_per_task', value: 2400 })
    expect(mapBudget({ budget_by: 'project_cost', budget: 5000 })).toEqual({ method: 'fee_total', value: 500000 })
    expect(mapBudget({ budget_by: 'none' })).toEqual({ method: 'none', value: null })
    expect(mapBudget({ budget: null })).toEqual({ method: 'none', value: null })
  })
  it('maps invoice + estimate states', () => {
    expect(mapInvoiceStatus('draft')).toBe('draft')
    expect(mapInvoiceStatus('open')).toBe('open')
    expect(mapInvoiceStatus('paid')).toBe('paid')
    expect(mapInvoiceStatus('closed')).toBe('closed')
    expect(mapInvoiceStatus(null)).toBe('open')
    expect(mapEstimateStatus('accepted')).toBe('accepted')
    expect(mapEstimateStatus('declined')).toBe('declined')
    expect(mapEstimateStatus('sent')).toBe('sent')
    expect(mapEstimateStatus('anything')).toBe('draft')
  })
  it('maps payment terms from free text', () => {
    expect(mapPaymentTerm('upon receipt')).toBe('due_on_receipt')
    expect(mapPaymentTerm('net 15')).toBe('net_15')
    expect(mapPaymentTerm('NET 30')).toBe('net_30')
    expect(mapPaymentTerm('net 45')).toBe('net_45')
    expect(mapPaymentTerm('net 60')).toBe('net_60')
    expect(mapPaymentTerm('')).toBe('net_30')
    expect(mapPaymentTerm('90 days')).toBe('custom')
  })
})
