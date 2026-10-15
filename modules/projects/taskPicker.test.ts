import { describe, expect, it } from 'vitest'
import { addableTaskOptions, compareTaskNames, type PickerTask } from './taskPicker'

const t = (id: string, name: string, archived = false): PickerTask => ({ id, name, archivedAt: archived ? new Date('2026-01-01') : null })

describe('Edit project "Add a task..." picker (AC-PROJ-015)', () => {
  it('lists every active task not already on the project', () => {
    const tasks = [t('a', 'Strategy'), t('b', 'Copy'), t('c', 'Old task', true), t('d', 'Accessibility')]
    expect(addableTaskOptions(tasks, new Set(['a']))).toEqual([
      { value: 'd', label: 'Accessibility' },
      { value: 'b', label: 'Copy' },
    ])
  })

  it('sorts alphabetically: case-insensitive, numbered tasks in number order', () => {
    const names = ['admin', 'Accounting', '10. COMMUNITY INVESTMENT', '09. CLIENT LIFECYCLE', 'Base Theme', '9. Nine', 'accessibility']
    const sorted = addableTaskOptions(names.map((n, i) => t(String(i), n)), new Set()).map((o) => o.label)
    expect(sorted).toEqual(['09. CLIENT LIFECYCLE', '9. Nine', '10. COMMUNITY INVESTMENT', 'accessibility', 'Accounting', 'admin', 'Base Theme'])
  })

  it('is empty when every active task is already on the project', () => {
    expect(addableTaskOptions([t('a', 'Copy'), t('b', 'Gone', true)], new Set(['a']))).toEqual([])
  })

  it('compareTaskNames ignores surrounding spaces and breaks case ties deterministically', () => {
    expect(compareTaskNames(' Copy', 'copy')).not.toBe(0)
    expect(compareTaskNames('Copy', 'Design')).toBeLessThan(0)
  })
})
