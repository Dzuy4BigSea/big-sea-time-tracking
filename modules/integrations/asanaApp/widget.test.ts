import { describe, it, expect } from 'vitest'
import { buildWidget, taskGidFromResourceUrl, taskResourceUrl } from './widget'

const NOW = new Date('2026-10-19T12:00:00Z')
const base = { visibleMinutes: 750, everyone: true, ownMinutes: 195, entryCount: 6, runningNames: [] as string[], lastDate: '2026-10-17', display: 'hh_mm' as const, now: NOW }

describe('buildWidget (AC-ASANAAPP-009)', () => {
  it('team view: total, own, last tracked, not running', () => {
    const w = buildWidget(base)
    expect(w.template).toBe('summary_with_details_v0')
    expect(w.metadata.title).toBe('12:30 tracked in Track2')
    expect(w.metadata.fields).toEqual([
      { type: 'pill', name: 'Timer', text: 'Not running', color: 'cool-gray' },
      { type: 'text_with_icon', name: 'Team total', text: '12:30' },
      { type: 'text_with_icon', name: 'Your time', text: '3:15' },
      { type: 'datetime_with_icon', name: 'Last tracked', datetime: '2026-10-17T12:00:00.000Z' },
    ])
  })
  it('member view hides the team total', () => {
    const w = buildWidget({ ...base, everyone: false, visibleMinutes: 195 })
    expect(w.metadata.fields.map((f: any) => f.name)).not.toContain('Team total')
    expect(w.metadata.subtitle).toBe('Your time on this task')
  })
  it('running pill names one person or counts several; decimal display', () => {
    expect(buildWidget({ ...base, runningNames: ['Dana Lee'] }).metadata.fields[0]).toMatchObject({ text: 'Running · Dana Lee', color: 'green' })
    expect(buildWidget({ ...base, runningNames: ['A', 'B'] }).metadata.fields[0]).toMatchObject({ text: 'Running · 2 people' })
    expect(buildWidget({ ...base, display: 'decimal' }).metadata.title).toBe('12.50 h tracked in Track2')
  })
  it('no time yet', () => {
    expect(buildWidget({ ...base, entryCount: 0, visibleMinutes: 0, ownMinutes: 0, lastDate: null }).metadata.title).toBe('No time tracked in Track2 yet')
  })
  it('keeps every field text within 40 chars', () => {
    const w = buildWidget({ ...base, runningNames: ['A very long person name that goes on and on'] })
    for (const f of w.metadata.fields as any[]) if (f.text) expect(f.text.length).toBeLessThanOrEqual(40)
  })
})

describe('resource URLs', () => {
  it('round-trips a task gid', () => {
    const url = taskResourceUrl('https://track2.bigseabridge.com/', '1205000000000001')
    expect(url).toBe('https://track2.bigseabridge.com/asana/t/1205000000000001')
    expect(taskGidFromResourceUrl('https://track2.bigseabridge.com', url)).toBe('1205000000000001')
  })
  it('rejects foreign or malformed URLs', () => {
    expect(taskGidFromResourceUrl('https://track2.bigseabridge.com', 'https://evil.com/asana/t/1')).toBeNull()
    expect(taskGidFromResourceUrl('https://track2.bigseabridge.com', 'https://track2.bigseabridge.com/asana/t/abc')).toBeNull()
    expect(taskGidFromResourceUrl('https://track2.bigseabridge.com', null)).toBeNull()
  })
})
