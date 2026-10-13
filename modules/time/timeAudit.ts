/**
 * Audit rows for time entries (create / update / delete / timer start + stop).
 *
 * Pure builders so the services and server actions can write the row inside the same
 * transaction as the change (tx.auditLog.create). `after.summary` is the timeline line that
 * lib/audit.ts listAudit reads; before/after carry the entry snapshot. The actor (who clicked)
 * and the subject (whose timesheet) are both recorded, so acting for a teammate is visible.
 */
import type { AuditAction, Prisma } from '@prisma/client'
import { formatMinutes } from '@/modules/shared/duration'

export const TIME_ENTRY_ENTITY = 'time_entry'

export interface TimeEntrySnapshot {
  minutes: number
  notes: string | null
  projectId: string
  taskId: string
  /** YYYY-MM-DD */
  spentDate: string
  isRunning: boolean
}

export function timeEntrySnapshot(e: {
  minutes: number
  notes: string | null
  projectId: string
  taskId: string
  spentDate: Date
  isRunning?: boolean
}): TimeEntrySnapshot {
  return {
    minutes: e.minutes,
    notes: e.notes ?? null,
    projectId: e.projectId,
    taskId: e.taskId,
    spentDate: e.spentDate.toISOString().slice(0, 10),
    isRunning: e.isRunning ?? false,
  }
}

export type TimeAuditEvent = 'logged' | 'updated' | 'deleted' | 'timer_started' | 'timer_stopped' | 'timer_auto_stopped'

const ACTIONS: Record<TimeAuditEvent, AuditAction> = {
  logged: 'create',
  updated: 'update',
  deleted: 'delete',
  timer_started: 'create',
  timer_stopped: 'state_change',
  timer_auto_stopped: 'state_change',
}

export function timeAuditSummary(
  event: TimeAuditEvent,
  snap: { before: TimeEntrySnapshot | null; after: TimeEntrySnapshot | null },
  forTeammate: boolean,
): string {
  const who = forTeammate ? ' for a teammate' : ''
  const m = (s: TimeEntrySnapshot | null) => formatMinutes(s?.minutes ?? 0)
  switch (event) {
    case 'logged':
      return `Logged ${m(snap.after)}${who} on ${snap.after?.spentDate}`
    case 'updated':
      return `Edited time entry${who}: ${m(snap.before)} → ${m(snap.after)}`
    case 'deleted':
      return `Deleted time entry${who} (${m(snap.before)} on ${snap.before?.spentDate})`
    case 'timer_started':
      return `Started timer${who}`
    case 'timer_stopped':
      return `Stopped timer${who} at ${m(snap.after)}`
    case 'timer_auto_stopped':
      return `Timer auto-stopped after 12h at ${m(snap.after)}`
  }
}

/** The AuditLog create input for a time-entry event. `actorUserId` null = system (cron). */
export function timeEntryAuditData(input: {
  accountId: string
  actorUserId: string | null
  subjectUserId: string
  entryId: string
  event: TimeAuditEvent
  before: TimeEntrySnapshot | null
  after: TimeEntrySnapshot | null
}): Prisma.AuditLogUncheckedCreateInput {
  const forTeammate = input.actorUserId !== null && input.actorUserId !== input.subjectUserId
  const summary = timeAuditSummary(input.event, { before: input.before, after: input.after }, forTeammate)
  return {
    accountId: input.accountId,
    actorUserId: input.actorUserId,
    entityType: TIME_ENTRY_ENTITY,
    entityId: input.entryId,
    action: ACTIONS[input.event],
    ...(input.before ? { before: { ...input.before } as Prisma.InputJsonValue } : {}),
    after: {
      summary,
      event: input.event,
      subjectUserId: input.subjectUserId,
      actedForTeammate: forTeammate,
      ...(input.after ?? {}),
    } as Prisma.InputJsonValue,
  }
}
