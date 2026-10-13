/**
 * Time-entry logic (specs/04-time-tracking.md).
 *
 * Pure helpers for timer transitions and edit/lock guards. Stored minutes are always
 * exact (rounding is a summary/invoice-layer concern — see modules/shared/duration).
 * The "one running timer per user" rule is also enforced by a DB partial unique index;
 * startTimerPlan expresses the stop-the-other side that the service performs in a txn.
 */

export type LockState = 'open' | 'approved' | 'invoiced'

/**
 * Longest a single timer run may count (12h). A timer left running overnight is capped here when
 * stopped, and the /api/cron/timers job stops any run that has gone past it.
 */
export const MAX_TIMER_MINUTES = 12 * 60

/** Note appended to an entry whose timer the cron job stopped. */
export const AUTO_STOP_NOTE = '(auto-stopped after 12h)'

/**
 * Minutes elapsed between timer start and stop, rounded to the nearest minute and capped at
 * MAX_TIMER_MINUTES so a forgotten timer can't book days of time.
 */
export function computeTimerMinutes(startedAt: Date, stoppedAt: Date, cap: number = MAX_TIMER_MINUTES): number {
  const ms = stoppedAt.getTime() - startedAt.getTime()
  if (ms <= 0) return 0
  return Math.min(Math.round(ms / 60_000), cap)
}

/** True when a timer started at `startedAt` has run past the cap at `now` (cron auto-stop). */
export function isRunawayTimer(startedAt: Date, now: Date, cap: number = MAX_TIMER_MINUTES): boolean {
  return now.getTime() - startedAt.getTime() > cap * 60_000
}

/** Notes after an auto-stop: the existing notes plus AUTO_STOP_NOTE (never appended twice). */
export function appendAutoStopNote(notes: string | null | undefined): string {
  const base = (notes ?? '').trim()
  if (base.endsWith(AUTO_STOP_NOTE)) return base
  return base ? `${base} ${AUTO_STOP_NOTE}` : AUTO_STOP_NOTE
}

/** Prisma's unique-constraint violation (here: the one_running_timer_per_user partial index). */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'
}

/** A repeat Start within this window on the same project/task is treated as a double-submit. */
export const DUPLICATE_START_WINDOW_MS = 10_000

/**
 * True when the user's running timer is the one this Start would create (same project and task,
 * started moments ago): a double-click or retried request, so the start is a no-op success
 * instead of stopping the fresh timer and opening a second, empty entry.
 */
export function isDuplicateStart(
  running: { projectId: string; taskId: string; timerStartedAt: Date | null } | null,
  input: { projectId: string; taskId: string; now: Date },
): boolean {
  if (!running?.timerStartedAt) return false
  if (running.projectId !== input.projectId || running.taskId !== input.taskId) return false
  const age = input.now.getTime() - running.timerStartedAt.getTime()
  return age >= -DUPLICATE_START_WINDOW_MS && age <= DUPLICATE_START_WINDOW_MS
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
