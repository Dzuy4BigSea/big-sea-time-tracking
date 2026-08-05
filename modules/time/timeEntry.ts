/**
 * Time-entry logic (specs/04-time-tracking.md).
 *
 * Pure helpers for timer transitions and edit/lock guards. Stored minutes are always
 * exact (rounding is a summary/invoice-layer concern — see modules/shared/duration).
 * The "one running timer per user" rule is also enforced by a DB partial unique index;
 * startTimerPlan expresses the stop-the-other side that the service performs in a txn.
 */

export type LockState = 'open' | 'approved' | 'invoiced'

/** Minutes elapsed between timer start and stop, rounded to the nearest minute. */
export function computeTimerMinutes(startedAt: Date, stoppedAt: Date): number {
  const ms = stoppedAt.getTime() - startedAt.getTime()
  if (ms <= 0) return 0
  return Math.round(ms / 60_000)
}

/** Only `open` entries are editable/deletable; approved & invoiced are immutable (INV-3). */
export function canEditEntry(lockState: LockState): boolean {
  return lockState === 'open'
}
export function canDeleteEntry(lockState: LockState): boolean {
  return lockState === 'open'
}

export class LockedEntryError extends Error {
  constructor(lockState: LockState, op: 'edit' | 'delete') {
    super(`Cannot ${op} a time entry that is ${lockState}`)
    this.name = 'LockedEntryError'
  }
}
export function assertEditable(lockState: LockState): void {
  if (!canEditEntry(lockState)) throw new LockedEntryError(lockState, 'edit')
}
export function assertDeletable(lockState: LockState): void {
  if (!canDeleteEntry(lockState)) throw new LockedEntryError(lockState, 'delete')
}

export interface StartTimerPlan {
  /** The id of the user's currently-running timer to stop first (null if none). */
  stopEntryId: string | null
  /** Minutes to finalize on the stopped entry (0 if none). */
  stopMinutes: number
}

/**
 * Plan for starting a new timer: stop the user's existing running timer, if any, so exactly
 * one remains running (AC-TIME-002 / AC-TIME-014). `now` is the moment the new timer starts.
 */
export function startTimerPlan(
  currentRunning: { id: string; timerStartedAt: Date } | null,
  now: Date,
): StartTimerPlan {
  if (!currentRunning) return { stopEntryId: null, stopMinutes: 0 }
  return {
    stopEntryId: currentRunning.id,
    stopMinutes: computeTimerMinutes(currentRunning.timerStartedAt, now),
  }
}
