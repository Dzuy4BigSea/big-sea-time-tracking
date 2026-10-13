import { describe, expect, it } from 'vitest'
import {
  decideExpenseUpdate, decideTimeEntryUpdate, harvestUpdatedAt, invoiceChangedInTrack2, isImportStamped,
  isMigrationLocked, numericMaxDocNumber, type ExistingTimeEntry, type InvoiceTrack2Activity,
} from './protect'

const at = (iso: string) => new Date(iso)

/** A keyed entry as the importer/rebuild leaves it: updatedAt stamped with Harvest's whole-second updated_at. */
const imported = (over: Partial<ExistingTimeEntry> = {}): ExistingTimeEntry => ({
  lockState: 'open',
  invoiceLineItemId: null,
  approvedTimesheetId: null,
  isRunning: false,
  createdAt: at('2026-10-14T10:00:00.123Z'),
  updatedAt: at('2026-09-01T12:00:00.000Z'),
  ...over,
})

describe('decideTimeEntryUpdate', () => {
  const newer = at('2026-10-20T08:00:00.000Z')

  it('updates an untouched imported entry when Harvest has a newer version', () => {
    expect(decideTimeEntryUpdate(imported(), newer)).toEqual({ action: 'update' })
  })

  it('updates a bulk-created entry (createdAt == updatedAt) that was never edited', () => {
    const t = at('2026-08-07T03:14:15.926Z')
    expect(decideTimeEntryUpdate(imported({ createdAt: t, updatedAt: t }), newer)).toEqual({ action: 'update' })
  })

  it('never overwrites an entry on a Track2 invoice line', () => {
    expect(decideTimeEntryUpdate(imported({ invoiceLineItemId: 'li_1' }), newer)).toEqual({ action: 'skip', reason: 'invoiced_in_track2' })
  })

  it('never overwrites locked, approved or running entries', () => {
    expect(decideTimeEntryUpdate(imported({ lockState: 'invoiced' }), newer)).toEqual({ action: 'skip', reason: 'locked' })
    expect(decideTimeEntryUpdate(imported({ lockState: 'approved' }), newer)).toEqual({ action: 'skip', reason: 'locked' })
    expect(decideTimeEntryUpdate(imported({ approvedTimesheetId: 'ts_1' }), newer)).toEqual({ action: 'skip', reason: 'approved_in_track2' })
    expect(decideTimeEntryUpdate(imported({ isRunning: true }), newer)).toEqual({ action: 'skip', reason: 'running' })
  })

  it('never overwrites an entry edited in Track2 after import (ms-precision updatedAt)', () => {
    const edited = imported({ updatedAt: at('2026-10-15T09:30:12.481Z') })
    expect(decideTimeEntryUpdate(edited, newer)).toEqual({ action: 'skip', reason: 'edited_in_track2' })
    // ...even when no Harvest timestamp is available
    expect(decideTimeEntryUpdate(edited, null)).toEqual({ action: 'skip', reason: 'edited_in_track2' })
  })

  it('does not roll an entry back when re-importing an older or identical Harvest version', () => {
    expect(decideTimeEntryUpdate(imported(), at('2026-09-01T12:00:00.000Z'))).toEqual({ action: 'skip', reason: 'unchanged' })
    expect(decideTimeEntryUpdate(imported(), at('2026-08-01T00:00:00.000Z'))).toEqual({ action: 'skip', reason: 'unchanged' })
  })
})

describe('isImportStamped / harvestUpdatedAt', () => {
  it('recognises Harvest whole-second stamps and same-write rows', () => {
    expect(isImportStamped({ createdAt: at('2026-10-01T00:00:00.500Z'), updatedAt: at('2026-09-01T00:00:01.000Z') })).toBe(true)
    expect(isImportStamped({ createdAt: at('2026-08-07T00:00:00.100Z'), updatedAt: at('2026-08-07T00:00:00.100Z') })).toBe(true)
    expect(isImportStamped({ createdAt: at('2026-08-07T00:00:00.100Z'), updatedAt: at('2026-10-01T00:00:00.101Z') })).toBe(false)
  })
  it('parses Harvest updated_at to whole seconds', () => {
    expect(harvestUpdatedAt('2026-09-01T12:00:00Z')?.toISOString()).toBe('2026-09-01T12:00:00.000Z')
    expect(harvestUpdatedAt('2026-09-01T12:00:00.750Z')?.toISOString()).toBe('2026-09-01T12:00:00.000Z')
    expect(harvestUpdatedAt(null)).toBeNull()
    expect(harvestUpdatedAt('nope')).toBeNull()
  })
})

describe('decideExpenseUpdate', () => {
  it('keeps invoiced or locked expenses', () => {
    expect(decideExpenseUpdate({ lockState: 'open', invoiceLineItemId: null })).toEqual({ action: 'update' })
    expect(decideExpenseUpdate({ lockState: 'open', invoiceLineItemId: 'li' }).action).toBe('skip')
    expect(decideExpenseUpdate({ lockState: 'invoiced', invoiceLineItemId: null }).action).toBe('skip')
  })
})

describe('invoiceChangedInTrack2', () => {
  const pristine: InvoiceTrack2Activity = {
    audits: [
      { actorUserId: null, summary: 'Imported from Harvest — invoice 7801' },
      { actorUserId: null, summary: 'Invoice sent to client' },
      { actorUserId: null, summary: 'Payment recorded — $1,200.00' },
      { actorUserId: null, summary: 'Closed' },
    ],
    paymentNotes: ['Imported from Harvest'],
    linkedItems: 0,
    externalIds: false,
  }
  it('treats an invoice with only importer activity as untouched', () => {
    expect(invoiceChangedInTrack2(pristine)).toBe(false)
    expect(invoiceChangedInTrack2({ audits: [], paymentNotes: [], linkedItems: 0, externalIds: false })).toBe(false)
  })
  it('detects any Track2 activity', () => {
    expect(invoiceChangedInTrack2({ ...pristine, audits: [...pristine.audits, { actorUserId: 'usr_1', summary: 'Invoice details edited' }] })).toBe(true)
    expect(invoiceChangedInTrack2({ ...pristine, audits: [{ actorUserId: null, summary: 'Paid online via Stripe — $5.00' }] })).toBe(true)
    expect(invoiceChangedInTrack2({ ...pristine, paymentNotes: ['Imported from Harvest', null] })).toBe(true)
    expect(invoiceChangedInTrack2({ ...pristine, linkedItems: 3 })).toBe(true)
    expect(invoiceChangedInTrack2({ ...pristine, externalIds: true })).toBe(true)
  })
})

describe('isMigrationLocked', () => {
  it('reads MIGRATION_LOCKED', () => {
    expect(isMigrationLocked({})).toBe(false)
    expect(isMigrationLocked({ MIGRATION_LOCKED: '0' })).toBe(false)
    expect(isMigrationLocked({ MIGRATION_LOCKED: '1' })).toBe(true)
    expect(isMigrationLocked({ MIGRATION_LOCKED: 'TRUE' })).toBe(true)
  })
})

describe('numericMaxDocNumber', () => {
  it('compares numerically, not alphabetically', () => {
    expect(numericMaxDocNumber(['999', '7801', '1002', null])).toBe(7801)
    expect(numericMaxDocNumber(['INV-0042', 'INV-0100'])).toBe(100)
    expect(numericMaxDocNumber(['draft', null])).toBeNull()
  })
})
