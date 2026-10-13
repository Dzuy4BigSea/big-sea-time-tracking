import { describe, it, expect } from 'vitest'
import { timeEntryAuditData, timeEntrySnapshot } from './timeAudit'

const snap = (minutes: number) =>
  timeEntrySnapshot({ minutes, notes: 'n', projectId: 'p', taskId: 'k', spentDate: new Date('2026-10-13T00:00:00Z') })

describe('timeEntryAuditData', () => {
  it('records before/after and the actor vs subject', () => {
    const row = timeEntryAuditData({
      accountId: 'a',
      actorUserId: 'pm',
      subjectUserId: 'u1',
      entryId: 'te1',
      event: 'updated',
      before: snap(60),
      after: snap(90),
    })
    expect(row).toMatchObject({ accountId: 'a', actorUserId: 'pm', entityType: 'time_entry', entityId: 'te1', action: 'update' })
    expect(row.before).toMatchObject({ minutes: 60, spentDate: '2026-10-13', projectId: 'p', taskId: 'k', notes: 'n' })
    expect(row.after).toMatchObject({ minutes: 90, subjectUserId: 'u1', actedForTeammate: true, summary: 'Edited time entry for a teammate: 1:00 → 1:30' })
  })
  it('delete keeps only the before snapshot; own entries are not "for a teammate"', () => {
    const row = timeEntryAuditData({ accountId: 'a', actorUserId: 'u1', subjectUserId: 'u1', entryId: 'te1', event: 'deleted', before: snap(45), after: null })
    expect(row.action).toBe('delete')
    expect(row.after).toMatchObject({ actedForTeammate: false, summary: 'Deleted time entry (0:45 on 2026-10-13)' })
  })
  it('system (cron) auto-stop has no actor', () => {
    const row = timeEntryAuditData({ accountId: 'a', actorUserId: null, subjectUserId: 'u1', entryId: 'te1', event: 'timer_auto_stopped', before: snap(0), after: snap(720) })
    expect(row.actorUserId).toBeNull()
    expect(row.after).toMatchObject({ summary: 'Timer auto-stopped after 12h at 12:00', actedForTeammate: false })
  })
})
