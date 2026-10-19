import { describe, it, expect } from 'vitest'
import { afterChange, buildForm, hasTrackFields, isStopForm, orderTasks, readValues, toCommand, type FormState, type FormValues } from './form'

const DEFAULTS: FormValues = {
  projectId: null, projectTitle: null, projectSubtitle: null, taskId: null, notes: 'Homepage hero', hours: '', date: '2026-10-19',
}
const TASKS = [{ id: 't1', label: 'Design' }, { id: 't2', label: 'Development' }]
const URLS = { projects: 'https://t2/api/projects', change: 'https://t2/api/change', submit: 'https://t2/api/submit' }
const state = (over: Partial<FormState> = {}): FormState => ({ linked: true, linkUrl: 'https://t2/link', values: DEFAULTS, tasks: [], running: null, urls: URLS, ...over })
const field = (form: ReturnType<typeof buildForm>, id: string) => (form.metadata.fields as { id: string }[]).find((f) => f.id === id) as Record<string, any> | undefined
const ids = (form: ReturnType<typeof buildForm>) => (form.metadata.fields as { id: string }[]).map((f) => f.id)

describe('buildForm', () => {
  it('unlinked person: explains how to link, no submit (AC-ASANAAPP-003)', () => {
    const f = buildForm(state({ linked: false }))
    expect(f.metadata).not.toHaveProperty('on_submit_callback')
    expect(JSON.stringify(f)).toContain('https://t2/link')
  })

  it('Harvest layout: project, notes, duration (blank = timer), date; no mode picker', () => {
    const f = buildForm(state())
    expect(ids(f)).toEqual(['project', 'notes', 'hours', 'date', 'submit_hint'])
    expect(field(f, 'project')).toMatchObject({ type: 'typeahead', typeahead_url: URLS.projects, is_watched: true })
    expect(field(f, 'notes')?.value).toBe('Homepage hero')
    expect(field(f, 'hours')).toMatchObject({ type: 'single_line_text', name: 'Duration', placeholder: 'Blank starts a timer' })
    expect(field(f, 'hours')).not.toHaveProperty('is_required')
    expect(field(f, 'date')?.value).toBe('2026-10-19')
    expect(f.metadata).not.toHaveProperty('on_submit_callback')
    expect(f.metadata.on_change_callback).toBe(URLS.change)
  })

  it('project + task chosen: task dropdown with value, submit enabled', () => {
    const f = buildForm(state({ values: { ...DEFAULTS, projectId: 'p1', projectTitle: 'Acme', taskId: 't2' }, tasks: TASKS }))
    expect(field(f, 'project')?.value).toEqual({ title: 'Acme', value: 'p1' })
    expect(field(f, 'task')).toMatchObject({ type: 'dropdown', value: 't2', options: [{ id: 't1', label: 'Design' }, { id: 't2', label: 'Development' }] })
    expect(f.metadata.on_submit_callback).toBe(URLS.submit)
  })

  it('shows the task total at the bottom, as Harvest does', () => {
    const f = buildForm(state({ totalLine: '14:00 tracked to this task in Track2' }))
    expect(ids(f).at(-1)).toBe('total')
    expect(field(f, 'total')?.name).toBe('14:00 tracked to this task in Track2')
  })

  it('warns that starting a timer stops one running elsewhere', () => {
    const f = buildForm(state({ running: { label: 'Other · Admin (0:10)', onThisTask: false } }))
    expect(field(f, 'running')?.name).toContain('Other · Admin (0:10)')
    expect(isStopForm({ running: { label: 'x', onThisTask: false } })).toBe(false)
  })

  it('timer running on this task: stop-only form (AC-ASANAAPP-007)', () => {
    const f = buildForm(state({ running: { label: 'Acme · Design (0:42)', onThisTask: true }, totalLine: '3:00 tracked to this task in Track2' }))
    expect(f.metadata.title).toBe('Stop timer')
    expect(ids(f)).toEqual(['running', 'stop_hint', 'total'])
    expect(f.metadata.on_submit_callback).toBe(URLS.submit)
    expect(f.metadata).not.toHaveProperty('on_change_callback')
  })

  it('a project with no tasks says so and keeps submit off', () => {
    const f = buildForm(state({ values: { ...DEFAULTS, projectId: 'p1' }, tasks: [] }))
    expect(field(f, 'task_none')).toBeTruthy()
    expect(f.metadata).not.toHaveProperty('on_submit_callback')
  })

  it('shows field and form errors and caps dropdown options at 50', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, label: `Task ${i}` }))
    const f = buildForm(state({ values: { ...DEFAULTS, projectId: 'p1', taskId: 't0' }, tasks: many, errors: { project: 'Nope' }, formError: 'Not assigned' }))
    expect(ids(f)[0]).toBe('form_error')
    expect(field(f, 'project')?.error).toBe('Nope')
    expect(field(f, 'task')?.options).toHaveLength(50)
  })
})

describe('readValues / hasTrackFields', () => {
  it('reads Asana value shapes', () => {
    const v = readValues({ project: { title: 'Acme', subtitle: 'Client', value: 'p1' }, task: 't1', notes: 'x', hours: '1:30', date: '2026-10-18T00:00:00.000Z' }, DEFAULTS)
    expect(v).toEqual({ projectId: 'p1', projectTitle: 'Acme', projectSubtitle: 'Client', taskId: 't1', notes: 'x', hours: '1:30', date: '2026-10-18' })
  })
  it('keeps defaults for fields Asana did not send', () => {
    expect(readValues({}, DEFAULTS)).toEqual(DEFAULTS)
  })
  it('tells the stop-only form (no fields) from the track form', () => {
    expect(hasTrackFields({})).toBe(false)
    expect(hasTrackFields({ project: { value: 'p1' } })).toBe(true)
  })
})

describe('afterChange', () => {
  it('picks the first task when the project changed', () => {
    expect(afterChange({ ...DEFAULTS, projectId: 'p2', taskId: 't1' }, 'project', [{ id: 'x', label: 'X' }]).taskId).toBe('x')
  })
  it('keeps a still-valid task otherwise', () => {
    expect(afterChange({ ...DEFAULTS, taskId: 't2' }, 'notes', TASKS).taskId).toBe('t2')
  })
})

describe('toCommand', () => {
  const ctx = { tasks: TASKS }
  it('blank duration starts a timer (AC-ASANAAPP-005)', () => {
    expect(toCommand({ ...DEFAULTS, projectId: 'p1', taskId: 't1', notes: '  hi ', hours: '  ' }, ctx)).toEqual({
      ok: true, command: { kind: 'start', projectId: 'p1', taskId: 't1', notes: 'hi', date: '2026-10-19' },
    })
  })
  it('a duration saves an entry: 1:30 → 90 minutes (AC-ASANAAPP-006)', () => {
    expect(toCommand({ ...DEFAULTS, projectId: 'p1', taskId: 't1', hours: '1:30' }, ctx)).toMatchObject({ ok: true, command: { kind: 'log', minutes: 90, date: '2026-10-19' } })
  })
  it('rejects bad, zero or > 24h durations and bad dates', () => {
    const ok = { ...DEFAULTS, projectId: 'p1', taskId: 't1' }
    expect(toCommand({ ...ok, hours: 'abc' }, ctx)).toMatchObject({ ok: false, errors: { hours: expect.any(String) } })
    expect(toCommand({ ...ok, hours: '0' }, ctx)).toMatchObject({ ok: false })
    expect(toCommand({ ...ok, hours: '25' }, ctx)).toMatchObject({ ok: false })
    expect(toCommand({ ...ok, date: '2026-02-30' }, ctx)).toMatchObject({ ok: false, errors: { date: expect.any(String) } })
  })
  it('requires project and a task that belongs to it', () => {
    expect(toCommand(DEFAULTS, ctx)).toMatchObject({ ok: false, errors: { project: expect.any(String) } })
    expect(toCommand({ ...DEFAULTS, projectId: 'p1', taskId: 'other' }, ctx)).toMatchObject({ ok: false, errors: { task: expect.any(String) } })
  })
})

describe('orderTasks', () => {
  it('recent first, then alphabetical with numbers in order', () => {
    const t = [{ id: 'a', label: 'task 10' }, { id: 'b', label: 'Task 2' }, { id: 'c', label: 'Admin' }]
    expect(orderTasks(t, []).map((x) => x.id)).toEqual(['c', 'b', 'a'])
    expect(orderTasks(t, ['a']).map((x) => x.id)).toEqual(['a', 'c', 'b'])
  })
})
