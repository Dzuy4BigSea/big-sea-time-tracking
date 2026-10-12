import { describe, it, expect } from 'vitest'
import { defaultTaskId, projectComboOptions, taskComboOptions, toTimeEntryProject } from './timeEntryProjects'
import { filterOptions, groupOptions } from './combobox'

const projects = [
  toTimeEntryProject({ id: 'p1', name: 'Website', code: 'ACM-01', clientName: 'Acme Co', tasks: [{ id: 't1', name: 'Design' }, { id: 't2', name: 'Dev' }] }),
  toTimeEntryProject({ id: 'p2', name: 'SEO', code: null, clientName: 'Acme Co', tasks: [{ id: 't3', name: 'Audit' }] }),
  toTimeEntryProject({ id: 'p3', name: 'Internal', code: null, clientName: 'Big Sea', tasks: [] }),
]

describe('toTimeEntryProject', () => {
  it('prefixes the code in the label', () => {
    expect(projects[0].name).toBe('[ACM-01] Website')
    expect(projects[1].name).toBe('SEO')
  })
})

describe('projectComboOptions', () => {
  it('groups projects under their client', () => {
    const sections = groupOptions(projectComboOptions(projects))
    expect(sections.map((s) => [s.group, s.options.map((o) => o.value)])).toEqual([
      ['Acme Co', ['p1', 'p2']],
      ['Big Sea', ['p3']],
    ])
  })
  it('is searchable by client name and code', () => {
    const opts = projectComboOptions(projects)
    expect(filterOptions(opts, 'big sea').map((o) => o.value)).toEqual(['p3'])
    expect(filterOptions(opts, 'acm-01').map((o) => o.value)).toEqual(['p1'])
  })
})

describe('taskComboOptions / defaultTaskId', () => {
  it('lists the chosen project’s tasks, ungrouped', () => {
    expect(taskComboOptions(projects, 'p1')).toEqual([
      { value: 't1', label: 'Design' },
      { value: 't2', label: 'Dev' },
    ])
  })
  it('is empty for an unknown project or one with no tasks', () => {
    expect(taskComboOptions(projects, 'nope')).toEqual([])
    expect(defaultTaskId(projects, 'p3')).toBe('')
  })
  it('preselects the first task', () => {
    expect(defaultTaskId(projects, 'p2')).toBe('t3')
  })
})
