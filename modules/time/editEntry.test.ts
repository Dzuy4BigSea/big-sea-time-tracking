import { describe, it, expect } from 'vitest'
import { editRefusal } from './editEntry'

describe('time entry edit guards (INV-3/INV-4)', () => {
  const open = { lockState: 'open', isRunning: false, invoiceLineItemId: null }
  it('open, stopped, un-invoiced entries are editable and deletable', () => {
    expect(editRefusal(open, 'edit')).toBeNull()
    expect(editRefusal(open, 'delete')).toBeNull()
  })
  it('approved or invoiced entries are immutable', () => {
    expect(editRefusal({ ...open, lockState: 'approved' }, 'edit')).toBe('locked')
    expect(editRefusal({ ...open, lockState: 'invoiced' }, 'delete')).toBe('locked')
  })
  it('entries reserved on a draft invoice are refused too', () => {
    expect(editRefusal({ ...open, invoiceLineItemId: 'li1' }, 'edit')).toBe('invoiced')
    expect(editRefusal({ ...open, invoiceLineItemId: 'li1' }, 'delete')).toBe('invoiced')
  })
  it('a running timer can be deleted but not edited', () => {
    expect(editRefusal({ ...open, isRunning: true }, 'edit')).toBe('running')
    expect(editRefusal({ ...open, isRunning: true }, 'delete')).toBeNull()
  })
})
